'use strict';

function leadingZero(num) {
	if (num > 9) {
		return num;
	}
	
	return '0' + num;
}

function log() {
	const dt = new Date;
	let args = Array.from(arguments);
	
	args.unshift(
		'[' +
		leadingZero(dt.getDate()) + '.' +
		leadingZero(dt.getMonth() + 1) + '.' +
		(dt.getFullYear()) + ' ' +
		leadingZero(dt.getHours()) + ':' +
		leadingZero(dt.getMinutes()) + ':' +
		leadingZero(dt.getSeconds()) +
		']'
	);
	
	console.log.apply(console, args);
}

module.exports = {
	log: log
};
