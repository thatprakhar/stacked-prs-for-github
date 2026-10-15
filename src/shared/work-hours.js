(function (root) {
  const formatters = new Map();

  function formatterFor(timeZone) {
    if (!formatters.has(timeZone)) {
      formatters.set(
        timeZone,
        new Intl.DateTimeFormat('en-US', {
          timeZone,
          hourCycle: 'h23',
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
        }),
      );
    }
    return formatters.get(timeZone);
  }

  function zonedParts(milliseconds, timeZone) {
    const parts = {};
    for (const part of formatterFor(timeZone).formatToParts(new Date(milliseconds))) {
      if (part.type !== 'literal') parts[part.type] = Number(part.value);
    }
    return parts;
  }

  function offsetMilliseconds(milliseconds, timeZone) {
    const parts = zonedParts(milliseconds, timeZone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return asUtc - Math.floor(milliseconds / 1000) * 1000;
  }

  function zonedTimeToUtc(year, month, day, hour, timeZone) {
    const wallClock = Date.UTC(year, month - 1, day, 0, Math.round(hour * 60));
    const firstGuess = wallClock - offsetMilliseconds(wallClock, timeZone);
    return wallClock - offsetMilliseconds(firstGuess, timeZone);
  }

  const MAXIMUM_DAYS = 3650;

  function workMilliseconds(startMilliseconds, endMilliseconds, schedule) {
    if (!(endMilliseconds > startMilliseconds)) return 0;
    const { timeZone, workdayStart, workdayEnd, workdays } = schedule;
    const start = zonedParts(startMilliseconds, timeZone);
    let calendarDay = Date.UTC(start.year, start.month - 1, start.day);
    let total = 0;
    for (let index = 0; index < MAXIMUM_DAYS; index += 1) {
      const date = new Date(calendarDay);
      const year = date.getUTCFullYear();
      const month = date.getUTCMonth() + 1;
      const day = date.getUTCDate();
      if (zonedTimeToUtc(year, month, day, 0, timeZone) >= endMilliseconds) break;
      if (workdays.includes(date.getUTCDay())) {
        const windowStart = zonedTimeToUtc(year, month, day, workdayStart, timeZone);
        const windowEnd = zonedTimeToUtc(year, month, day, workdayEnd, timeZone);
        total += Math.max(0, Math.min(windowEnd, endMilliseconds) - Math.max(windowStart, startMilliseconds));
      }
      calendarDay += 86400000;
    }
    return total;
  }

  function workHours(startMilliseconds, endMilliseconds, schedule) {
    return workMilliseconds(startMilliseconds, endMilliseconds, schedule) / 3600000;
  }

  const api = { workHours, zonedTimeToUtc };
  root.GitHubStacks = Object.assign(root.GitHubStacks || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
