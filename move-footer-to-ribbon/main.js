'use strict';

const { Plugin, setIcon } = require('obsidian');

/*
 * 左下角 footer（仓库切换 / 帮助 / 设置）收进左侧 ribbon 竖条。
 * 做法：footer 里三个真实按钮保留原位但整体隐藏（body.mfr-done，
 * 见 styles.css），在 ribbon 的 .side-dock-settings（1.15 原生底部
 * 槽位，默认为空）里创建三个代理按钮——克隆原按钮的 svg 图标与
 * aria-label，点击转发给原按钮，行为与原按钮完全一致。
 * 代理方式避免了跨容器搬节点，卸载即完全还原。
 */
module.exports = class MoveFooterToRibbon extends Plugin {
	onload() {
		this.ensureFn = () => this.ensure();
		this.app.workspace.onLayoutReady(() => this.schedule());
		this.registerEvent(this.app.workspace.on('layout-change', this.ensureFn));
	}

	onunload() {
		this.stopSchedule();
		if (this.menuMo) {
			this.menuMo.disconnect();
			this.menuMo = null;
		}
		if (this.menuGuard) {
			clearTimeout(this.menuGuard);
			this.menuGuard = null;
		}
		document.body.classList.remove('mfr-pin');
		document
			.querySelectorAll('.workspace-ribbon .mfr-item')
			.forEach((el) => el.remove());
		document.body.classList.remove('mfr-done');
	}

	schedule() {
		// footer 挂载时机不定：立即尝试一次，之后每 2s 兜底、最多 15 次
		this.stopSchedule();
		if (this.ensure()) return;
		let tries = 0;
		this.timer = setInterval(() => {
			if (this.ensure() || ++tries >= 15) this.stopSchedule();
		}, 2000);
	}

	stopSchedule() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	parts() {
		const footer = document.querySelector(
			'.mod-primary-split .workspace-sidedock-vault-profile, .mod-left-split .workspace-sidedock-vault-profile'
		);
		if (!footer) return null;
		const actions = footer.querySelector('.workspace-drawer-vault-actions');
		// Minimal hide-help/hide-settings 规则佐证：actions 内 first-child=帮助、last-child=设置
		const icons = actions ? Array.from(actions.querySelectorAll('.clickable-icon')) : [];
		const switcher = footer.querySelector('.workspace-drawer-vault-switcher');
		if (icons.length < 2 && !switcher) return null;
		return {
			footer,
			switcher,
			help: icons[0] || null,
			settings: icons[icons.length - 1] || null,
		};
	}

	ensure() {
		const ribbon = document.querySelector('.workspace-ribbon.mod-primary, .workspace-ribbon.mod-left');
		const parts = this.parts();
		if (!ribbon || !parts) return false;

		let dest = ribbon.querySelector('.side-dock-settings');
		if (!dest) {
			dest = document.createElement('div');
			dest.className = 'side-dock-settings';
			ribbon.appendChild(dest);
		}
		if (dest.querySelector('.mfr-item')) return true; // 已注入

		const targets = [
			[parts.switcher, `切换仓库（当前：${this.app.vault.getName()}）`],
			[parts.help, '帮助'],
			[parts.settings, '设置'],
		].filter(([orig]) => orig);
		for (const [orig, fallback] of targets) {
			dest.appendChild(this.buildProxy(orig, orig === parts.switcher, fallback));
		}
		document.body.classList.add('mfr-done');
		return true;
	}

	buildProxy(orig, isSwitcher, fallbackLabel) {
		const btn = document.createElement('div');
		btn.className = 'clickable-icon side-dock-ribbon-action mfr-item';
		const svg = orig.querySelector('svg');
		if (svg) {
			btn.appendChild(svg.cloneNode(true));
		} else {
			setIcon(btn, isSwitcher ? 'chevrons-up-down' : 'circle-dot');
		}
		// 原按钮 1.15 里没有 aria-label（帮助/设置），用 fallback 补全悬停提示
		btn.setAttribute('aria-label', orig.getAttribute('aria-label') || fallbackLabel);
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.forwardTo(orig, e, btn, isSwitcher);
		});
		return btn;
	}

	/*
	 * 向原按钮转发完整指针序列。仅 orig.click() 不够：
	 * 仓库切换器监听 mousedown/pointerdown（下拉菜单在按下时弹出），
	 * 帮助/设置监听 click（1.15 里各自打开独立窗口）。
	 * 坐标取代理按钮自身的位置，菜单/弹层锚定在 ribbon 侧而非隐藏的原 footer；
	 * el.click()/键盘激活无坐标时用按钮中心兜底。
	 */
	forwardTo(orig, e, btn, wantMenuPin) {
		let cx = e.clientX || 0, cy = e.clientY || 0;
		if (!cx && !cy) {
			const b = btn.getBoundingClientRect();
			cx = b.x + b.width / 2;
			cy = b.y + b.height / 2;
		}
		const base = {
			bubbles: true, cancelable: true, composed: true, view: window,
			clientX: cx, clientY: cy,
			button: 0, buttons: 1,
		};
		const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
		const up = { ...base, buttons: 0 };
		orig.dispatchEvent(new PointerEvent('pointerdown', pointer));
		orig.dispatchEvent(new MouseEvent('mousedown', base));
		orig.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0 }));
		orig.dispatchEvent(new MouseEvent('mouseup', up));
		orig.dispatchEvent(new MouseEvent('click', up));
		if (wantMenuPin) this.pinWhileMenuOpen();
	}

	/*
	 * 仓库菜单打开期间钉住 ribbon 展开态（body.mfr-pin，见 styles.css）：
	 * 鼠标从按钮移到菜单上时 :hover 丢失，竖条会缩回，观感断裂。
	 * 菜单是异步挂载的（且后台窗口 rAF 会被暂停，不能用 rAF 等它），
	 * 改用 MutationObserver 监听 body：.menu 出现即钉、移除即解。
	 * 500ms 内没等到菜单就撤岗，避免日后误钉住无关的右键菜单。
	 */
	pinWhileMenuOpen() {
		if (this.menuMo) this.menuMo.disconnect();
		if (this.menuGuard) clearTimeout(this.menuGuard);
		if (document.querySelector('.menu')) document.body.classList.add('mfr-pin');
		this.menuMo = new MutationObserver(() => {
			const open = !!document.querySelector('.menu');
			const pinned = document.body.classList.contains('mfr-pin');
			if (open && !pinned) {
				document.body.classList.add('mfr-pin');
			} else if (!open && pinned) {
				document.body.classList.remove('mfr-pin');
				this.menuMo.disconnect();
				this.menuMo = null;
			}
		});
		this.menuMo.observe(document.body, { childList: true });
		this.menuGuard = setTimeout(() => {
			if (!document.querySelector('.menu') && this.menuMo) {
				this.menuMo.disconnect();
				this.menuMo = null;
			}
		}, 500);
	}
};
