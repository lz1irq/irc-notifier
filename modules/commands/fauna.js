'use strict';

let oauth2;
let authState = {};

function setAccessToken(ircbot, sender, accountName, token) {
	authState[accountName] = {
		token: token
	};

	ircbot.say(sender, 'Authentication successful!');
}

function getAccountName(ircbot, replyTo, sender, callback) {
	ircbot.remoteWhois(sender, function(info) {
		if (!('secure_connection' in info)) {
			ircbot.say(replyTo, sender + ': This command only works over secure IRC connections');
			return;
		}

		if (!('account' in info)) {
			ircbot.say(replyTo, sender + ': You are not logged in to IRC services. Please login and retry.');
			return;
		}

		callback(info.account);
	});
}

function getAuthURL(config, sender, accountName, callback) {
	const crypto = require('crypto');
	let authParams = config.fauna.oauth2.authParams;

	crypto.randomBytes(32, (err, buf) => {
		if (err) {
			throw err;
		}

		let state = buf.toString('hex');

		authState[accountName] = {
			state: state,
			currentNickname: sender
		};

		authParams.state = state;

		callback(oauth2.authorizationCode.authorizeURL(authParams));
	});
}

function checkUserToken(ircbot, replyTo, sender, callbackFound, callbackNotFound) {
	getAccountName(ircbot, replyTo, sender, function(accountName) {
		if (!(accountName in authState) || !('token' in authState[accountName])) {
			return callbackNotFound(accountName);
		}

		let token = authState[accountName].token;

		if (token.expired()) {
			ircbot.say(sender, 'Your token has expired, trying to refresh...');

			return token.refresh((error, token) => {
				setAccessToken(ircbot, sender, accountName, token);
				callbackFound(token, accountName);
			});
		}

		return callbackFound(token, accountName);
	});
}

function getUserToken(ircbot, config, replyTo, sender, callback) {
	checkUserToken(ircbot, replyTo, sender, callback, function(accountName) {
		return getAuthURL(config, sender, accountName, function(authorizationURL) {
			ircbot.say(replyTo, 'You are not authorized - please follow the instructions in the private message');
			ircbot.say(sender, 'Please authorize the bot to Fauna: ' + authorizationURL);
			
			if (config.fauna.oauth2.authParams.redirect_uri === 'urn:ietf:wg:oauth:2.0:oob') {
				ircbot.say(sender, 'After you receive the code, please enter it here, in the following format: !fauna auth <your code here>');
			}
		});
	});
}

function getAccessToken(ircbot, config, sender, accountName, code) {
	oauth2.authorizationCode.getToken({
		code: code,
		redirect_uri: config.fauna.oauth2.authParams.redirect_uri
	}, (error, result) => {
		if (error) {
			return ircbot.say(sender, 'Access Token Error: ' + error.message);
		}

		const token = oauth2.accessToken.create(result);

		setAccessToken(ircbot, sender, accountName, token);
	});
}

function auth(ircbot, config, replyTo, sender, code) {
	getAccountName(ircbot, replyTo, sender, function(accountName) {
		getAccessToken(ircbot, config, sender, accountName, code);
	});
}

function deauth(ircbot, replyTo, sender) {
	checkUserToken(ircbot, replyTo, sender, function(token, accountName) {
		token.revoke('access_token', (error) => {
			if (error) {
				ircbot.say(replyTo, 'Error revoking access token: ' + error.message);
				return;
			}

			token.revoke('refresh_token', (error) => {
				if (error) {
					ircbot.say(replyTo, 'Error revoking refresh token: ' + error.message);
					return;
				}

				delete authState[accountName];
				ircbot.say(replyTo, 'Access tokens revoked successfully');
			});
		});
	}, function() {
		ircbot.say(replyTo, 'You are not authorized, so there\'s nothing to revoke');
	});
}

function executeCommand(ircbot, config, utils, replyTo, sender, cmd) {
	getUserToken(ircbot, config, replyTo, sender, function(token, accountName) {
		utils.request.postOAuth2(config.fauna.urls.actions.door, {
			door_action: {
				name: cmd
			}
		}, token.token.access_token, function() {
			ircbot.say(replyTo, 'Action ' + cmd + ' successful');
		}, function(error) {
			ircbot.say(replyTo, 'Failed executing action: ' + error);
		});
	});
}

function showHelp(ircbot, replyTo) {
	ircbot.say(replyTo, 'Subcommands list: open/lock/unlock - control door, deauth - revoke tokens, info - show your account info, help - show this help');
}

function showInfo(ircbot, config, utils, replyTo, sender) {
	getUserToken(ircbot, config, replyTo, sender, function(token, accountName) {
		utils.request.getJsonOAuth2(config.fauna.urls.resourceOwner, token.token.access_token, function(data) {
			ircbot.say(replyTo, sender + ' is logged in to IRC as ' + accountName + ' and has linked the following Fauna account:');
			ircbot.say(replyTo, 'Username: ' + data.username + ', Name: ' + data.name + ', Roles: ' + data.roles.join(', '));
		}, function(error) {
			ircbot.say(replyTo, 'Failed getting user info: ' + error);
		});
	});
}

function showInvalidCommand(ircbot, replyTo) {
	ircbot.say(replyTo, 'Invalid subcommand, try !fauna help');
}

module.exports = {
	key: 'fauna',
	description: 'interacts with init Lab\'s fauna',
	init: function(ircbot, config, utils, next) {
		new utils.httpServer.Server(config.fauna.http, function(error) {
			if (error) {
				console.log(error);
			}

			next();
		}, function(dispatcher) {
			dispatcher.onGet('/oauth/fauna/callback', function(req, res) {
				const URL = require('url');
				const QS = require('querystring');

				const url = URL.parse(req.url);
				const query = QS.parse(url.query);
				
				if (!('code' in query) || !('state' in query)) {
					res.writeHead(400, {
						'Content-Type': 'text/plain'
					});

					res.end('Missing request parameters');
					return;
				}
				
				let accountName;
				
				Object.keys(authState).forEach(function(key) {
					if (accountName) {
						return;
					}
					
					if (!('state' in authState[key])) {
						return;
					}

					if (authState[key].state !== query.state) {
						return;
					}
					
					accountName = key;
				});
				
				if (accountName) {
					const userState = authState[accountName];
					
					getAccessToken(ircbot, config, userState.currentNickname, accountName, query.code);
					
					res.writeHead(200, {
						'Content-Type': 'text/plain'
					});

					res.end('Authorization successful! You can close this page.');
					return;
				}

				res.writeHead(400, {
					'Content-Type': 'text/plain'
				});

				res.end('Authorization state not valid. Please retry.');
			});
		});
	},
	execute: function(ircbot, config, utils, replyTo, sender, text) {
		if (!oauth2) {
			oauth2 = require('simple-oauth2').create(config.fauna.oauth2.credentials);
		}
		
		const authPrefix = 'auth ';
		if (text.indexOf(authPrefix) === 0) {
			auth(ircbot, config, replyTo, sender, text.substr(authPrefix.length));
			return;
		}

		switch (text) {
			case 'deauth':
				deauth(ircbot, replyTo, sender);
				break;
			case 'open':
			case 'lock':
			case 'unlock':
				executeCommand(ircbot, config, utils, replyTo, sender, text);
				break;
			case 'help':
				showHelp(ircbot, replyTo);
				break;
			case 'info':
			case '':
				showInfo(ircbot, config, utils, replyTo, sender);
				break;
			default:
				showInvalidCommand(ircbot, replyTo);
				break;
		}
	}
};
