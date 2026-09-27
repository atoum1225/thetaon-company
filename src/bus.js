// 서버 안에서 "새 메시지", "업무 상태 바뀜", "지금 누가 무슨 일 하는 중"을 알리는 통로.
// 화면이 이걸 받아 실시간으로 띄운다.
const { EventEmitter } = require('events');
const bus = new EventEmitter();
bus.setMaxListeners(50);

const PURPOSE_NAMES = {
  define: '과제를 정리하는 중', speak: '회의에서 발언을 준비하는 중', advise_meeting: '회의 조언을 준비하는 중',
  chair: '회의 진행을 판단하는 중', minutes: '회의록과 배정안을 쓰는 중', work: '산출물을 쓰는 중',
  review: '검수하는 중', advise: '전략 조언을 쓰는 중', adopt: '조언 반영 여부를 판단하는 중',
  final: '최종 보고서를 쓰는 중', reply_ceo: '대표님 말씀에 답하는 중',
};

// 지금 진행 중인 AI 작업(한 번에 하나). 새로 연결된 화면에도 알려 주려고 기억해 둔다.
bus.current = null;
// 받침이 있으면 "이", 없으면 "가" (황기획이, 김비서가)
const subj = (name) => {
  const c = name.charCodeAt(name.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 ? `${name}이` : `${name}가`;
};
bus.startWork = (w) => {
  bus.current = { ...w, label: `${subj(w.who)} ${PURPOSE_NAMES[w.purpose] || '작업하는 중'}` };
  bus.emit('working', bus.current);
};
bus.endWork = () => {
  const done = bus.current;
  bus.current = null;
  bus.emit('working', done ? { taskId: done.taskId, done: true } : { done: true });
};

module.exports = bus;
