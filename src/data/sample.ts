import type { Gender, LifeEvent, TreeData, Union, UnionStatus } from '../types';
import { emptyTree } from '../types';

/**
 * Demo family (4 generations) covering the tricky cases:
 *  - remarriage with a half-sibling (Ahmet: Zeynep then Elif)
 *  - unknown parent (Deniz has only a mother)
 *  - depth-limit badges (great-grandparents, niece's family)
 */

interface P {
  id: string;
  given: string;
  sur: string;
  g: Gender;
  b?: LifeEvent;
  d?: LifeEvent;
  occ?: string;
}

const y = (year: number, place?: string): LifeEvent => ({
  date: { year },
  ...(place ? { place } : {}),
});

const PERSONS: P[] = [
  // great-grandparents
  { id: 'ibrahim', given: 'İbrahim', sur: 'Yılmaz', g: 'M', b: y(1900, 'Konya'), d: y(1970) },
  { id: 'hatice', given: 'Hatice', sur: 'Yılmaz', g: 'F', b: y(1908, 'Konya'), d: y(1985) },
  // grandparents
  { id: 'mehmet', given: 'Mehmet', sur: 'Yılmaz', g: 'M', b: y(1928, 'Konya'), d: y(1995, 'Ankara'), occ: 'Farmer' },
  { id: 'fatma', given: 'Fatma', sur: 'Yılmaz', g: 'F', b: y(1932, 'Konya'), d: y(2010, 'Ankara') },
  { id: 'hasan', given: 'Hasan', sur: 'Demir', g: 'M', b: y(1930, 'İzmir'), d: y(2001, 'İzmir'), occ: 'Teacher' },
  { id: 'ayse', given: 'Ayşe', sur: 'Demir', g: 'F', b: y(1936, 'İzmir') },
  // parents' generation
  { id: 'ahmet', given: 'Ahmet', sur: 'Yılmaz', g: 'M', b: y(1955, 'Ankara'), occ: 'Engineer' },
  { id: 'zeynep', given: 'Zeynep', sur: 'Kaya', g: 'F', b: y(1957, 'Ankara') },
  { id: 'elif', given: 'Elif', sur: 'Yılmaz', g: 'F', b: y(1958, 'İzmir'), occ: 'Doctor' },
  { id: 'hulya', given: 'Hülya', sur: 'Yılmaz', g: 'F', b: y(1959, 'Ankara') },
  { id: 'mustafa', given: 'Mustafa', sur: 'Demir', g: 'M', b: y(1961, 'İzmir') },
  { id: 'leyla', given: 'Leyla', sur: 'Demir', g: 'F', b: y(1963, 'Bursa') },
  { id: 'nazli', given: 'Nazlı', sur: 'Aksoy', g: 'F', b: y(1960, 'İstanbul') },
  // focus generation
  { id: 'murat', given: 'Murat', sur: 'Yılmaz', g: 'M', b: y(1979, 'Ankara') },
  { id: 'emre', given: 'Emre', sur: 'Yılmaz', g: 'M', b: y(1985, 'Ankara'), occ: 'Architect' },
  { id: 'selin', given: 'Selin', sur: 'Yılmaz', g: 'F', b: y(1988, 'Ankara') },
  { id: 'deniz', given: 'Deniz', sur: 'Yılmaz', g: 'F', b: y(1987, 'İstanbul'), occ: 'Designer' },
  { id: 'can', given: 'Can', sur: 'Öztürk', g: 'M', b: y(1986, 'İstanbul') },
  { id: 'cem', given: 'Cem', sur: 'Demir', g: 'M', b: y(1990, 'İzmir') },
  // children
  { id: 'ela', given: 'Ela', sur: 'Yılmaz', g: 'F', b: y(2015, 'İstanbul') },
  { id: 'aras', given: 'Aras', sur: 'Yılmaz', g: 'M', b: y(2018, 'İstanbul') },
  { id: 'zeynep_o', given: 'Zeynep', sur: 'Öztürk', g: 'F', b: y(2016, 'İstanbul') },
];

interface U {
  id: string;
  partners: string[];
  children: string[];
  status: UnionStatus;
  marriage?: LifeEvent;
  divorce?: LifeEvent;
}

const UNIONS: U[] = [
  { id: 'u_ggp', partners: ['ibrahim', 'hatice'], children: ['mehmet'], status: 'married' },
  { id: 'u_gp1', partners: ['mehmet', 'fatma'], children: ['ahmet', 'hulya'], status: 'married', marriage: y(1953, 'Konya') },
  { id: 'u_gp2', partners: ['hasan', 'ayse'], children: ['elif', 'mustafa'], status: 'married', marriage: y(1956, 'İzmir') },
  { id: 'u_az', partners: ['ahmet', 'zeynep'], children: ['murat'], status: 'divorced', marriage: y(1977), divorce: y(1981) },
  { id: 'u_ae', partners: ['ahmet', 'elif'], children: ['emre', 'selin'], status: 'married', marriage: y(1983, 'Ankara') },
  { id: 'u_ml', partners: ['mustafa', 'leyla'], children: ['cem'], status: 'married' },
  // Deniz's father is unknown: single-partner union
  { id: 'u_n', partners: ['nazli'], children: ['deniz'], status: 'unknown' },
  { id: 'u_ed', partners: ['emre', 'deniz'], children: ['ela', 'aras'], status: 'married', marriage: y(2012, 'İstanbul') },
  { id: 'u_sc', partners: ['selin', 'can'], children: ['zeynep_o'], status: 'married', marriage: y(2014) },
];

export function sampleTree(): TreeData {
  const data = emptyTree('Yılmaz Family');
  for (const p of PERSONS) {
    data.persons[p.id] = {
      id: p.id,
      givenName: p.given,
      surname: p.sur,
      gender: p.g,
      unionsAsPartner: [],
      ...(p.b ? { birth: p.b } : {}),
      ...(p.d ? { death: p.d, isDeceased: true } : {}),
      ...(p.occ ? { occupation: p.occ } : {}),
    };
  }
  for (const u of UNIONS) {
    const union: Union = {
      id: u.id,
      partners: u.partners,
      status: u.status,
      children: u.children,
      ...(u.marriage ? { marriage: u.marriage } : {}),
      ...(u.divorce ? { divorce: u.divorce } : {}),
    };
    data.unions[u.id] = union;
    for (const pid of u.partners) data.persons[pid].unionsAsPartner.push(u.id);
    for (const cid of u.children) data.persons[cid].unionAsChild = u.id;
  }
  data.focusId = 'emre';
  return data;
}
