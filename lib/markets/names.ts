/** Trading temperaments and market creatures, so nobody has to stop and think of a room name. */
const TEMPERAMENTS = [
  "Patient", "Steady", "Bold", "Calm", "Swift", "Sharp", "Quiet", "Keen",
  "Early", "Clever", "Brave", "Lucky", "Cool", "Nimble", "Wise", "Easy",
] as const;
const CREATURES = [
  "Bull", "Bear", "Whale", "Hawk", "Owl", "Fox", "Falcon", "Otter",
  "Lynx", "Heron", "Wolf", "Dolphin", "Orca", "Raven", "Tiger", "Panda",
] as const;

const LAST_NAME = "fourfivex:markets:display-name";

const pick = <T,>(list: readonly T[], random: () => number) => list[Math.floor(random() * list.length) % list.length];

/** A name like "Patient Bull". Never the one passed as `current`, so asking again always changes it. */
export function suggestName(current?: string, random: () => number = Math.random): string {
  let name: string;
  do name = `${pick(TEMPERAMENTS, random)} ${pick(CREATURES, random)}`;
  while (name === current);
  return name;
}

/** The name last used to open or join a room on this device, so returning people can carry straight on. */
export function lastDisplayName(): string | null {
  try {
    const name = localStorage.getItem(LAST_NAME)?.trim();
    return name && name.length <= 32 ? name : null;
  } catch {
    return null;
  }
}

export function rememberDisplayName(name: string) {
  try {
    localStorage.setItem(LAST_NAME, name);
  } catch {
    /* storage blocked: the next room gets a fresh suggestion */
  }
}
