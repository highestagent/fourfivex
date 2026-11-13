import type { DeepPartial, Styles } from 'klinecharts';

const canvasTokens = {
  page: '--page', ink: '--ink', muted: '--muted', line: '--line',
  blue: '--blue', blueLine: '--blue-line', blueWash: '--blue-wash',
  green: '--green', greenInk: '--green-ink', greenWash: '--green-wash',
  rose: '--rose', roseInk: '--rose-ink', roseWash: '--rose-wash',
  grid: '--chart-grid', guide: '--chart-guide', study: '--chart-study', mono: '--mono',
};

type Palette = Record<keyof typeof canvasTokens, string>;
let cached: { theme: string; palette: Palette } | undefined;

export function chartPalette(): Palette {
  const theme = document.documentElement.dataset.theme ??
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  if (cached?.theme === theme) return cached.palette;
  const sample = document.createElement('span');
  sample.className = 'markets-ui';
  sample.hidden = true;
  document.body.append(sample);
  const values = Object.entries(canvasTokens).map(([key, name]) => {
    if (key === 'mono') {
      sample.style.fontFamily = `var(${name})`;
      return [key, getComputedStyle(sample).fontFamily];
    }
    sample.style.color = `var(${name})`;
    return [key, getComputedStyle(sample).color];
  });
  sample.remove();
  const palette = Object.fromEntries(values) as Palette;
  cached = { theme, palette };
  return palette;
}

export function chartStyles(): DeepPartial<Styles> {
  const colors = chartPalette();
  const typography = { color: colors.muted, family: colors.mono, size: 10 };
  const priceLabel = { color: colors.page, family: colors.mono, size: 10 };
  const axis = { axisLine: { color: colors.line }, tickLine: { color: colors.line }, tickText: typography };
  const crosshair = { line: { color: colors.guide }, text: { ...priceLabel, backgroundColor: colors.ink, borderColor: colors.ink, borderRadius: 4 } };
  const direction = { upColor: colors.green, downColor: colors.rose, noChangeColor: colors.guide };
  const indicatorMarks = [{ ...direction, style: 'fill' as const, borderStyle: 'solid' as const, borderSize: 1, borderDashedValue: [2, 2] }];
  const studyLine = { size: 1.15, smooth: false };
  return {
    grid: { horizontal: { color: colors.grid }, vertical: { color: colors.grid } },
    candle: {
      bar: {
        upColor: colors.green, downColor: colors.rose,
        upWickColor: colors.green, downWickColor: colors.rose,
        upBorderColor: colors.green, downBorderColor: colors.rose,
      },
      area: { lineColor: colors.blue, backgroundColor: colors.blueWash },
      priceMark: {
        high: { color: colors.muted, textFamily: colors.mono },
        low: { color: colors.muted, textFamily: colors.mono },
        last: { upColor: colors.greenInk, downColor: colors.roseInk, noChangeColor: colors.ink, text: priceLabel },
      },
      tooltip: { showRule: 'none' },
    },
    indicator: {
      ohlc: direction,
      bars: indicatorMarks,
      circles: indicatorMarks,
      lines: [
        { ...studyLine, color: colors.blue, style: 'solid', dashedValue: [2, 2] },
        { ...studyLine, color: colors.ink, style: 'dashed', dashedValue: [4, 3] },
        { ...studyLine, color: colors.study, style: 'solid', dashedValue: [2, 2] },
        { ...studyLine, color: colors.muted, style: 'dashed', dashedValue: [2, 2] },
        { ...studyLine, color: colors.study, style: 'dashed', dashedValue: [7, 3] },
      ],
      tooltip: { showRule: 'always', title: typography, legend: typography },
    },
    separator: { size: 1, color: colors.line, activeBackgroundColor: colors.blueWash },
    xAxis: axis,
    yAxis: axis,
    crosshair: { horizontal: crosshair, vertical: crosshair },
    overlay: {
      line: { color: colors.blue, size: 1.25 },
      point: { color: colors.page, borderColor: colors.blue, activeColor: colors.blue, activeBorderColor: colors.page },
      text: { ...priceLabel, backgroundColor: colors.blue, borderRadius: 4 },
    },
  };
}
