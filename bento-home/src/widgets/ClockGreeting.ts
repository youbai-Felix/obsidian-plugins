import { moment, setIcon } from 'obsidian';
import type { WidgetDef, WidgetHost, WidgetInstance } from '../types';

function greeting(hour: number): [string, string] {
  if (hour < 5) return ['moon', '夜深了'];
  if (hour < 11) return ['sunrise', '早上好'];
  if (hour < 13) return ['sun', '中午好'];
  if (hour < 18) return ['sun', '下午好'];
  if (hour < 23) return ['sunset', '晚上好'];
  return ['moon', '夜深了'];
}

export const clockDef: WidgetDef = {
  type: 'clock',
  name: '时钟问候',
  icon: 'sun',
  chrome: 'plain',
  defaults: { colSpan: 2, rowSpan: 1 },
  create(host: WidgetHost, _widget, ui): WidgetInstance {
    const wrap = ui.bodyEl.createDiv({ cls: 'bh-clock' });
    const greetEl = wrap.createDiv({ cls: 'bh-clock-greet' });
    const iconEl = greetEl.createSpan({ cls: 'bh-clock-icon' });
    const textEl = greetEl.createSpan({ cls: 'bh-clock-text' });
    const timeEl = wrap.createDiv({ cls: 'bh-clock-time' });
    const dateEl = wrap.createDiv({ cls: 'bh-clock-date' });

    const tick = () => {
      const m = moment();
      const [icon, word] = greeting(m.hour());
      setIcon(iconEl, icon);
      const name = host.settings().greetingName.trim();
      textEl.setText(name ? `${word}，${name}` : word);
      timeEl.setText(m.format('HH:mm'));
      dateEl.setText(m.format('YYYY年M月D日 dddd'));
    };
    tick();
    // 15s 足够维持分钟精度，避免每秒重绘
    const timer = window.setInterval(tick, 15000);

    return {
      destroy() {
        window.clearInterval(timer);
      },
    };
  },
};
