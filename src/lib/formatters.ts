/**
 * Format seconds to mm:ss or h:mm:ss display.
 */
export function formatTime(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00';

  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format a total duration in seconds to a human-readable string like "1 hr 23 min".
 */
export function formatDuration(totalSeconds: number): string {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);

  if (hrs > 0) {
    return `${hrs} hr ${mins} min`;
  }
  return `${mins} min`;
}

/**
 * Truncate a string to a max length with ellipsis.
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

/**
 * Pluralize a Russian word for track count (треков/трек/трека).
 */
export function pluralizeTracks(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod100 >= 11 && mod100 <= 19) return `${count} треков`;
  if (mod10 === 1) return `${count} трек`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} трека`;
  return `${count} треков`;
}

/**
 * Pluralize a Russian word for likes count (лайков/лайк/лайка).
 */
export function pluralizeLikes(count: number): string {
  const formattedCount = count.toLocaleString('ru-RU');
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod100 >= 11 && mod100 <= 19) return `${formattedCount} лайков`;
  if (mod10 === 1) return `${formattedCount} лайк`;
  if (mod10 >= 2 && mod10 <= 4) return `${formattedCount} лайка`;
  return `${formattedCount} лайков`;
}

/**
 * Format an ISO date or timestamp into a friendly relative Russian string.
 */
export function formatRelativeTime(dateString?: string | null): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 60) return 'Только что';
  if (diffSec < 3600) {
    const mins = Math.floor(diffSec / 60);
    const mod10 = mins % 10;
    const mod100 = mins % 100;
    const word =
      mod100 >= 11 && mod100 <= 19
        ? 'минут'
        : mod10 === 1
        ? 'минуту'
        : mod10 >= 2 && mod10 <= 4
        ? 'минуты'
        : 'минут';
    return `${mins} ${word} назад`;
  }
  if (diffSec < 86400 && date.getDate() === now.getDate()) {
    const hours = Math.floor(diffSec / 3600);
    const mod10 = hours % 10;
    const mod100 = hours % 100;
    const word =
      mod100 >= 11 && mod100 <= 19
        ? 'часов'
        : mod10 === 1
        ? 'час'
        : mod10 >= 2 && mod10 <= 4
        ? 'часа'
        : 'часов';
    return `${hours} ${word} назад`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()
  ) {
    return 'Вчера';
  }
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}


