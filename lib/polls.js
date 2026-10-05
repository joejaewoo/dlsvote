export const brand = '즐거움 Live';
export const tagline = 'Delightful Experiences Education';
export const eventTitle = '2026 파닉스 설명회';
export const polls = [
  { id: 'dinner', shortTitle: '오늘밤 저메추', title: '오늘 밤, 뭐 먹을까요?', color: 'orange', select: 3,
    options: ['스시', '마라탕', '김치찌개', '쌀국수', '샤브샤브', '족발', '샐러드', '삼겹살', '파스타'],
    emoji: ['🍣', '🌶️', '🍲', '🍜', '🥘', '🍖', '🥗', '🥓', '🍝'] },
  { id: 'academy', shortTitle: '학원 선택 기준', title: '학원을 선택하는 제일 중요한 기준은 무엇인가요?', color: 'blue', select: 3,
    options: ['관리', '원장 마인드', '동기부여(재미)', '시험영어 아웃풋', '언어영어 아웃풋', '커리큘럼', '맞춤학습 제공', '원비', '시간표'],
    emoji: ['✅', '💡', '🎈', '📝', '🗣️', '📚', '🎯', '💳', '🕒'] }
];
export const validToken = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const findPoll = id => polls.find(poll => poll.id === id);
export function validateBallot(data) {
  if (!data || !validToken(data.voter) || !validToken(data.round)) return '투표 화면을 새로 열어주세요.';
  const poll = findPoll(data.poll);
  if (!poll) return '올바른 투표를 선택해주세요.';
  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length !== poll.select || new Set(choices).size !== poll.select || !choices.every(choice => poll.options.includes(choice)))
    return `서로 다른 항목 ${poll.select}개를 선택해주세요.`;
  return null;
}
export function tally(poll, ballots) {
  const results = poll.options.map((label, index) => ({ label, emoji: poll.emoji[index], index,
    votes: ballots.filter(ballot => ballot.choices.includes(label)).length }));
  results.sort((a, b) => b.votes - a.votes || a.index - b.index);
  return { ...poll, total: ballots.length * poll.select, results };
}
