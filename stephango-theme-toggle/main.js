'use strict';

const { Plugin } = require('obsidian');

const BTN_CLASS = 'stp-theme-toggle';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * 在每个 markdown 视图 header 的 view-actions 最左侧注入
 * stephango.com 同款暗色模式滑动开关。
 * 视觉状态完全由 body.theme-dark 驱动（见 styles.css），
 * JS 只负责注入 DOM 与切换主题。
 */
module.exports = class StephangoThemeToggle extends Plugin {
	onload() {
		this.injectAllFn = () => this.injectAll();

		this.app.workspace.onLayoutReady(() => this.injectAll());
		this.registerEvent(this.app.workspace.on('active-leaf-change', this.injectAllFn));
		this.registerEvent(this.app.workspace.on('layout-change', this.injectAllFn));

		// 主题被其它入口（设置面板等）切换时保持 aria 状态同步
		this.observer = new MutationObserver(() => this.syncAll());
		this.observer.observe(document.body, {
			attributes: true,
			attributeFilter: ['class'],
		});
	}

	onunload() {
		if (this.observer) this.observer.disconnect();
		document.querySelectorAll('.' + BTN_CLASS).forEach((el) => el.remove());
	}

	async toggleTheme() {
		if (this.applying) return;
		this.applying = true;
		try {
			// changeTheme 异步生效，快速连点时可能被吞——生效后校验 body class，未翻转则重试
			for (let attempt = 0; attempt < 3; attempt++) {
				const wasDark = document.body.classList.contains('theme-dark');
				await this.app.changeTheme(wasDark ? 'moonstone' : 'obsidian');
				let flipped = false;
				for (let i = 0; i < 20; i++) {
					if (document.body.classList.contains('theme-dark') !== wasDark) {
						flipped = true;
						break;
					}
					await sleep(100);
				}
				if (flipped) break;
				console.warn('[stephango-theme-toggle] theme flip not confirmed, retrying');
			}
		} catch (e) {
			console.error('[stephango-theme-toggle] changeTheme failed', e);
		} finally {
			this.applying = false;
			this.syncAll();
		}
	}

	injectAll() {
		document
			.querySelectorAll('.workspace-leaf-content[data-type="markdown"] .view-actions')
			.forEach((actions) => {
				if (actions.querySelector('.' + BTN_CLASS)) return;
				actions.insertBefore(this.buildButton(), actions.firstChild);
			});
	}

	buildButton() {
		const btn = document.createElement('div');
		btn.className = 'view-action ' + BTN_CLASS;
		btn.setAttribute('aria-label', '切换暗色模式');
		btn.setAttribute('role', 'switch');
		this.syncState(btn);

		const slide = document.createElement('div');
		slide.className = 'stp-slide';
		const knob = document.createElement('div');
		knob.className = 'stp-knob';
		btn.appendChild(slide);
		btn.appendChild(knob);

		btn.addEventListener('click', () => this.toggleTheme());
		return btn;
	}

	syncAll() {
		document.querySelectorAll('.' + BTN_CLASS).forEach((btn) => this.syncState(btn));
	}

	syncState(btn) {
		btn.setAttribute(
			'aria-checked',
			document.body.classList.contains('theme-dark') ? 'true' : 'false'
		);
	}
};
