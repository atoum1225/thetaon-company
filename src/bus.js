// 서버 안에서 "새 메시지", "업무 상태 바뀜"을 알리는 통로. 메신저 화면이 이걸 받아 실시간으로 띄운다.
const { EventEmitter } = require('events');
const bus = new EventEmitter();
bus.setMaxListeners(50);
module.exports = bus;
