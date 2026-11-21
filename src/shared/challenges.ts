export interface ChallengeDefinition {
  id: number;
  numberLabel: string;
  title: string;
  description: string;
  shortHint: string;
  iconName:
    | 'cake'
    | 'palette'
    | 'briefcase'
    | 'type'
    | 'lightbulb'
    | 'plane'
    | 'heart'
    | 'languages'
    | 'mapPin';
  cardBg: string;
  cardBorder: string;
  iconBg: string;
  accentText: string;
}

export const TOTAL_CHALLENGES = 9;

export const CHALLENGES: ChallengeDefinition[] = [
  {
    id: 1,
    numberLabel: '01',
    title: 'BIRTHDAY TWIN',
    description: 'Find someone born in the same month as you.',
    shortHint: 'Same birth month',
    iconName: 'cake',
    cardBg: '#F9E7AE',
    cardBorder: '#EBD182',
    iconBg: '#FFF8DF',
    accentText: '#7D5A08',
  },
  {
    id: 2,
    numberLabel: '02',
    title: 'COLOUR CONNECTION',
    description: 'Find someone wearing the same dominant colour as you.',
    shortHint: 'Same outfit colour',
    iconName: 'palette',
    cardBg: '#FAD3CA',
    cardBorder: '#F28B78',
    iconBg: '#FFF1EE',
    accentText: '#9E3320',
  },
  {
    id: 3,
    numberLabel: '03',
    title: 'FELLOW FACILITATOR',
    description: 'Find someone who shares the same professional profile as you.',
    shortHint: 'Same work profile',
    iconName: 'briefcase',
    cardBg: '#CFE5D7',
    cardBorder: '#97C9AA',
    iconBg: '#EEF8F2',
    accentText: '#1A5E4B',
  },
  {
    id: 4,
    numberLabel: '04',
    title: 'SAME, SAME, BUT DIFFERENT',
    description: 'Find someone whose first name starts with the same letter as yours.',
    shortHint: 'Same first initial',
    iconName: 'type',
    cardBg: '#DCD3F0',
    cardBorder: '#BAAAE2',
    iconBg: '#F4F0FC',
    accentText: '#49357B',
  },
  {
    id: 5,
    numberLabel: '05',
    title: 'THE LEARNING BUG',
    description: 'Find someone who recently learned a completely new skill.',
    shortHint: 'Learned a new skill',
    iconName: 'lightbulb',
    cardBg: '#D5E4F5',
    cardBorder: '#A3C4E8',
    iconBg: '#EFF6FD',
    accentText: '#1E4C7A',
  },
  {
    id: 6,
    numberLabel: '06',
    title: 'PASSPORT PALS',
    description: 'Find someone who loves travelling as much as you do.',
    shortHint: 'Loves travelling',
    iconName: 'plane',
    cardBg: '#FBE0C4',
    cardBorder: '#F0BC89',
    iconBg: '#FFF5EB',
    accentText: '#874811',
  },
  {
    id: 7,
    numberLabel: '07',
    title: 'PASSION MATCH',
    description: 'Find someone who shares your favourite hobby.',
    shortHint: 'Same fav hobby',
    iconName: 'heart',
    cardBg: '#F7D7E3',
    cardBorder: '#EBA4BE',
    iconBg: '#FDF0F5',
    accentText: '#8A254B',
  },
  {
    id: 8,
    numberLabel: '08',
    title: 'POLYGLOT PRO',
    description: 'Find someone who can speak three or more languages.',
    shortHint: 'Speaks 3+ languages',
    iconName: 'languages',
    cardBg: '#CBECE8',
    cardBorder: '#7CC7BE',
    iconBg: '#EDF9F8',
    accentText: '#16635D',
  },
  {
    id: 9,
    numberLabel: '09',
    title: 'ROOTS & ROUTES',
    description: 'Find someone from your hometown or who has lived there.',
    shortHint: 'Same hometown',
    iconName: 'mapPin',
    cardBg: '#DFECCF',
    cardBorder: '#B4CF96',
    iconBg: '#F4F9EE',
    accentText: '#3A5E1B',
  },
];

export function getChallengeById(challengeId: number): ChallengeDefinition | undefined {
  return CHALLENGES.find((c) => c.id === challengeId);
}
