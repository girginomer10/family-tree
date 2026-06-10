import type { Person, TreeData } from '../types';
import { fullName, isAlive } from '../types';

export interface TreeStats {
  total: number;
  male: number;
  female: number;
  unknownGender: number;
  living: number;
  deceased: number;
  unions: number;
  marriedUnions: number;
  divorcedUnions: number;
  avgLifespan: number | null;
  longestLife: { name: string; years: number; personId: string } | null;
  oldestLiving: { name: string; age: number; personId: string } | null;
  earliestBirth: { name: string; year: number; personId: string } | null;
  birthsPerDecade: { decade: number; count: number }[];
  topSurnames: { name: string; count: number }[];
  topGivenNames: { name: string; count: number }[];
  topBirthPlaces: { name: string; count: number }[];
  withPhotos: number;
  withBirthDates: number;
}

function topCounts(values: string[], n: number): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const k = v.trim();
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, n);
}

export function computeStats(data: TreeData, currentYear: number): TreeStats {
  const persons = Object.values(data.persons);
  const unions = Object.values(data.unions);

  let male = 0;
  let female = 0;
  let unknownGender = 0;
  let living = 0;
  const lifespans: number[] = [];
  let longestLife: TreeStats['longestLife'] = null;
  let oldestLiving: TreeStats['oldestLiving'] = null;
  let earliestBirth: TreeStats['earliestBirth'] = null;
  const decades = new Map<number, number>();
  let withPhotos = 0;
  let withBirthDates = 0;

  const consider = (p: Person) => {
    if (p.gender === 'M') male++;
    else if (p.gender === 'F') female++;
    else unknownGender++;
    if (isAlive(p)) living++;
    if (p.photoUrl) withPhotos++;

    const b = p.birth?.date?.year;
    const d = p.death?.date?.year;
    if (b != null) {
      withBirthDates++;
      const decade = Math.floor(b / 10) * 10;
      decades.set(decade, (decades.get(decade) ?? 0) + 1);
      if (!earliestBirth || b < earliestBirth.year)
        earliestBirth = { name: fullName(p), year: b, personId: p.id };
    }
    if (b != null && d != null && d >= b) {
      const span = d - b;
      lifespans.push(span);
      if (!longestLife || span > longestLife.years)
        longestLife = { name: fullName(p), years: span, personId: p.id };
    }
    if (b != null && isAlive(p)) {
      const age = currentYear - b;
      if (age >= 0 && age < 120 && (!oldestLiving || age > oldestLiving.age))
        oldestLiving = { name: fullName(p), age, personId: p.id };
    }
  };
  persons.forEach(consider);

  const birthsPerDecade = [...decades.entries()]
    .map(([decade, count]) => ({ decade, count }))
    .sort((a, b) => a.decade - b.decade);

  return {
    total: persons.length,
    male,
    female,
    unknownGender,
    living,
    deceased: persons.length - living,
    unions: unions.length,
    marriedUnions: unions.filter((u) => u.status === 'married').length,
    divorcedUnions: unions.filter((u) => u.status === 'divorced').length,
    avgLifespan: lifespans.length
      ? Math.round(lifespans.reduce((a, b) => a + b, 0) / lifespans.length)
      : null,
    longestLife,
    oldestLiving,
    earliestBirth,
    birthsPerDecade,
    topSurnames: topCounts(persons.map((p) => p.surname), 5),
    topGivenNames: topCounts(persons.map((p) => p.givenName), 5),
    topBirthPlaces: topCounts(persons.map((p) => p.birth?.place ?? ''), 5),
    withPhotos,
    withBirthDates,
  };
}
