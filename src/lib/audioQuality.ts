import type { StreamInfo } from '../api';
import type { AudioQuality } from '../features/player/playerStore';

export interface AudioQualityDetails {
  codec: string;
  bitrateText: string;
  sampleRateText: string;
  bitDepthText: string;
  channelsText: string;
  isHiRes: boolean;
  badgeLabel: 'Hi-Res' | 'HiFi' | 'HQ' | 'SQ';
  fullSummary: string;
}

/**
 * Parses and formats audio quality details (codec, bit depth, sample rate, bitrate, channels)
 * from real-time stream metadata with graceful fallbacks.
 */
export function getAudioQualityDetails(
  streamInfo: StreamInfo | null | undefined,
  fallbackQuality: AudioQuality = 'high'
): AudioQualityDetails {
  // If we have live stream metadata from playback
  if (streamInfo) {
    const rawCodec = (streamInfo.codec || '').toUpperCase();
    const isFlac = rawCodec.includes('FLAC') || streamInfo.quality === 'Flac';
    const codec = isFlac ? 'FLAC' : rawCodec.includes('AAC') ? 'AAC' : 'MP3';

    const bitDepth = streamInfo.bit_depth || 16;
    const sampleRate = streamInfo.sample_rate || 44100;
    // For FLAC, bitrates are variable lossless (~700-1100 kbps).
    // Guard against erroneous values (< 300 kbps) with typical lossless estimate (920 kbps).
    const bitrate = isFlac
      ? (streamInfo.bitrate && streamInfo.bitrate >= 300 ? streamInfo.bitrate : 920)
      : (streamInfo.bitrate || (streamInfo.quality === 'High' ? 320 : 128));
    const channels = streamInfo.channels || 2;

    const isHiRes = isFlac && (bitDepth > 16 || sampleRate > 48000);
    const badgeLabel = isHiRes
      ? 'Hi-Res'
      : isFlac
      ? 'HiFi'
      : (streamInfo.quality === 'High' || bitrate >= 320)
      ? 'HQ'
      : 'SQ';

    const sampleRateKhz = (sampleRate / 1000).toFixed(sampleRate % 1000 === 0 ? 0 : 1);
    const sampleRateText = `${sampleRateKhz} кГц`;
    const bitDepthText = `${bitDepth} бит`;
    const bitrateText = `${bitrate} кбит/с`;
    const channelsText = channels === 1 ? 'Моно' : 'Стерео';

    const parts: string[] = [codec];
    if (isFlac) {
      parts.push(`${bitDepthText} / ${sampleRateText}`);
    } else {
      parts.push(sampleRateText);
    }
    parts.push(bitrateText);

    return {
      codec,
      bitrateText,
      sampleRateText,
      bitDepthText,
      channelsText,
      isHiRes,
      badgeLabel,
      fullSummary: parts.join(' • '),
    };
  }

  // Static fallback before stream metadata is loaded
  if (fallbackQuality === 'flac') {
    return {
      codec: 'FLAC',
      bitrateText: 'до 1411 кбит/с',
      sampleRateText: '44.1 кГц',
      bitDepthText: '16 бит',
      channelsText: 'Стерео',
      isHiRes: false,
      badgeLabel: 'HiFi',
      fullSummary: 'FLAC • 16 бит / 44.1 кГц • до 1411 кбит/с',
    };
  }

  if (fallbackQuality === 'high') {
    return {
      codec: 'MP3',
      bitrateText: '320 кбит/с',
      sampleRateText: '44.1 кГц',
      bitDepthText: '16 бит',
      channelsText: 'Стерео',
      isHiRes: false,
      badgeLabel: 'HQ',
      fullSummary: 'MP3 • 320 кбит/с • 44.1 кГц',
    };
  }

  return {
    codec: 'MP3',
    bitrateText: '128 кбит/с',
    sampleRateText: '44.1 кГц',
    bitDepthText: '16 бит',
    channelsText: 'Стерео',
    isHiRes: false,
    badgeLabel: 'SQ',
    fullSummary: 'MP3 • 128 кбит/с • 44.1 кГц',
  };
}

