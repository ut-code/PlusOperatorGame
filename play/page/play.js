class WeightRandom {
	#weight;
	constructor(weight) {
		this.#weight = [...weight];
		for (let i = 1; i < this.#weight.length; i++)
			this.#weight[i] += this.#weight[i - 1];
	}
	get() {
		const rand = Math.random() * this.#weight.at(-1);
		return this.#weight.findIndex((v) => v > rand);
	}
}

class State {
	static oninit = () => { };
	static onfocus = () => { };
	static onunfocus = () => { };
	static onenabled = () => { };
	static ondisabled = () => { };

	constructor(key, n, create) {
		this.key = key;
		this.values = [...Array(n)].map(() => create());
		this.valid = Array(n).fill(true);
		this.chosen = -1;
		this.create = create;

		this.values.forEach((value, index) => State.oninit(this.key, index, value));
	}
	get value() {
		if (this.chosen === -1) return null;
		return this.values[this.chosen];
	}
	get info() {
		return {
			value: this.value,
			index: this.chosen
		};
	}
	make(value) {
		if (this.chosen === -1) return;
		this.values[this.chosen] = value ?? this.create();
	}
	focus(n) {
		if (n === this.chosen) n = -1;
		if (n !== -1 && !this.valid[n]) return;

		if (n !== -1 && this.valid[n]) {
			State.onfocus(this.key, n);
		}
		this.chosen = n;

		for (let i = 0; i < this.values.length; i++)
			if (i !== n) this.unfocus(i);
	}
	unfocus(n) {
		if (n === -1) return;
		State.onunfocus(this.key, n);
	}
	filter(isValid) {
		this.values.forEach((value, i) => {
			const valid = isValid ? isValid(value) : true;
			if (!this.valid[i] && valid) {
				this.valid[i] = true;
				State.onenabled(this.key, i);
			}
			if (this.valid[i] && !valid) {
				this.valid[i] = false;
				State.ondisabled(this.key, i);
				if (this.chosen === i)
					this.focus(-1);
			}
		});
	}
}

const gcd = (a, b) => a % b ? gcd(b, a % b) : b;

class Op {
	static list = [
		new Op('add', (f, p) => f + p),
		new Op('sub', (f, p) => Math.abs(f - p), {
			wrap: (arr, f, p) => f < p && ([arr.field, arr.num] = [arr.num, arr.field])
		}),

		new Op('mul', (f, p) => f * p),
		new Op('div', (f, p) => Math.floor(f / p), {
			isPValid: (p) => p != 0
		}),
		new Op('rem', (f, p) => f % p, {
			isPValid: (p) => p !== 0
		}),

		new Op('and', (f, p) => f & p),
		new Op('or', (f, p) => f | p),
		new Op('xor', (f, p) => f ^ p),
		new Op('pop', (f) => {
			let c = 0;
			while (f != 0) {
				c += f % 2;
				f >>= 1;
			}
			return c;
		}, {
			r_param: false,
			wrap: (arr) => [arr.op, arr.field] = [arr.field, arr.op]
		}),

		new Op('root', (f) => Math.floor(Math.sqrt(f)), {
			r_param: false,
			wrap: (arr) => [arr.op, arr.field] = [arr.field, arr.op]
		}),

		new Op('d', (f) => {
			let c = 0;
			for (let i = 1; i <= f; i++)
				if (f % i == 0) c++;
			return c;
		}, {
			r_param: false,
			isFValid: (f) => f !== 0
		}),

		new Op('gcd', (f, p) => gcd(f, p), {
			isFValid: (f) => f !== 0,
			isPValid: (p) => p !== 0,
			wrap: (arr) => [arr.num, arr.op] = [arr.op, arr.num]
		})
	];

	constructor(name, calc, option = {}) {
		this.name = name;
		this.calc = calc;
		this.r_param = option.r_param ?? true;

		this.isFValid = option.isFValid ?? (() => true);
		this.isPValid = this.r_param ? (option.isPValid ?? (() => true)) : () => false;
		this.wrap = option.wrap ?? (() => { });
	}
	getArrange(f, p) {
		const arr = this.r_param
			? {
				field: -45,
				op: -25,
				num: -5,
				apply: 15,
				new_field: 40
			}
			: {
				field: -35,
				op: -15,
				apply: 5,
				new_field: 30
			};
		this.wrap(arr, f, p);
		return arr;
	}
}

class Game {
	onapply = () => { };

	constructor(level) {
		this.level = level;

		this.opgen = new WeightRandom([
			[1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
			[1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1],
			[1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
		][level]);

		const easyOps = ['add', 'sub', 'mul', 'div'];
		const normalOps = ['rem','root','d','gcd'];
		const hardOps = ['and', 'or', 'xor', 'pop'];

		let enabledOps =[];
		switch(level) {
			case 'easy':
				enabledOps = easyOps;
				break;
			case 'normal':
				enabledOps = [...easyOps, ...normalOps];
				break;
			case 'hard':
				enabledOps = [...easyOps, ...normalOps, ...hardOps];
				break;
			default:
				enabledOps = easyOps;
		}

		this.ops = Op.list.filter(op => enabledOps.includes(op.name));

		this.state = {
			field: new State('field', 6, () => Math.floor(Math.random() * 18 + 2)),
			num: new State('num', 4, () => Math.floor(Math.random() * 6)),
			op: new State('op', 4, () => Math.floor(Math.random() * this.ops.length)),
			apply: new State('apply', 1, () => '=')
		};

		this.input = false;
	}

	apply() {
		if (!this.input || !this.valid) return;

		const field = this.state.field.value,
			op = this.state.op.value,
			num = this.state.num.value;

		this.state.num.filter(() => true);

		this.state.field.make(this.ops[op].calc(field, num));
		this.state.op.make();
		this.state.num.make();

		this.onapply(
			{ field, op: this.ops[op], num },
			{ field: this.state.field.value, op: this.state.op.value, num: this.state.num.value },
			{ field: this.state.field.chosen, op: this.state.op.chosen, num: this.state.num.chosen, apply: 0 }
		);

		this.state.field.focus(-1);
		this.state.op.focus(-1);
		this.state.num.focus(-1);
	}

	accept() {
		this.input = true;
	}
	block() {
		this.input = false;
	}

	get valid() {
		if (this.state.field.value === null) return false;
		if (this.state.op.value === null) return false;
		if (!this.ops[this.state.op.value].r_param) return true;
		return this.state.num.value !== null;
	}

	click(key, index) {
		if (!this.input) return;

		switch (key) {
			case 'field':
				this.state.field.focus(index);
				break;
			case 'op':
				this.state.op.focus(index);
				this.state.field.filter(this.ops[this.state.op.value]?.isFValid);
				this.state.num.filter(this.ops[this.state.op.value]?.isPValid);
				break;
			case 'num':
				this.state.num.focus(index);
				break;
		}

		this.state.apply.filter(() => this.valid);
	}

	get cleared() {
		return this.state.field.values.find((value) => value != 1) === undefined;
	}
}

var game;

const cards = {
	field: document.querySelectorAll('#field>.card'),
	op: document.querySelectorAll('#op>.card'),
	num: document.querySelectorAll('#num>.card'),
	apply: document.querySelectorAll('#apply'),
	dummy: document.querySelectorAll('#dummy')
};

for (const key in cards) {
	if (key === 'dummy');
	else if (key === 'apply')
		cards.apply[0].addEventListener('click', () => game.apply());
	else
		cards[key].forEach((card, i) => {
			card.addEventListener('click', () => game.click(key, i));
		});
}

async function animate(ele, keyframes, duration) {
	const anime = ele.animate(keyframes, {
		duration,
		fill: 'forwards',
		easing: 'ease-in-out'
	});
	await anime.finished;
	anime.commitStyles();
	anime.cancel();
}

async function startAnimation() {
	[...cards.field].forEach((ele) => {
		ele.classList.remove('display');
		ele.style.opacity = 0;
	});
	[...cards.op].forEach((ele) => ele.style.opacity = 0);
	[...cards.num].forEach((ele) => ele.style.opacity = 0);

	await new Promise((resolve) => setTimeout(resolve, 200));

	await Promise.all(
		[...cards.field].map((ele, i) => animate(ele, [
			{
				translate: `${(2.5 - i) * 10}rem -20rem 0`,
				opacity: 0
			},
			{
				translate: '0 0 0',
				opacity: 1
			}
		], 500))
	);

	await Promise.all([
		...[...cards.op].map((ele, i) => animate(ele, [
			{
				scale: 0,
				opacity: 0
			},
			{
				scale: 1,
				opacity: 1
			}
		], 500)),
		...[...cards.num].map((ele, i) => animate(ele, [
			{
				scale: 0,
				opacity: 0
			},
			{
				scale: 1,
				opacity: 1
			}
		], 500)),
	]);

	[...cards.op].forEach((ele) => ele.removeAttribute('style'));
	[...cards.num].forEach((ele) => ele.removeAttribute('style'));
}

async function applyAnimation(old, renew, index) {
	const getCenter = (ele) => {
		const rect = ele.getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	}

	const arrange = old.op.getArrange(old.field, old.num);
	const keys = Object.keys(arrange).filter((v) => v != 'new_field');
	const rest = keys.filter((v) => v != 'field');

	const ele = keys.reduce((acc, key) => ({ ...acc, [key]: cards[key][index[key]] }), { apply: cards.apply[0] });
	const center = Object.keys(ele).reduce((acc, key) => ({ ...acc, [key]: getCenter(ele[key]) }), {});

	ele.dummy = cards.dummy[0];

	for (const key of keys) {
		ele[key].style.zIndex = 1;
		ele[key].classList.add('display');
	}
	ele.field.style.zIndex = 2;

	// カードを中心に
	await Promise.all(
		keys.map((key, i) => {
			return animate(ele[key], {
				translate: `calc(50vw - ${center[key].x}px + ${arrange[key]}rem) calc(50vh - ${center[key].y}px) 0`,
				scale: (key === 'field' ? 2 / 3 : 1) * 1.5
			}, 500);
		})
	);

	await new Promise((resolve) => setTimeout(resolve, 200));

	// 両端のカード入れ替え
	Object.assign(ele.dummy.style, {
		display: 'flex',
		left: `calc(50vw + ${arrange.field}rem) `,
		top: `50vh`,
		translate: '-50% -50% 0',
		scale: 1.5
	});
	ele.dummy.textContent = ele.field.textContent;

	ele.field.textContent = `${renew.field}`;
	ele.field.style.translate = `calc(50vw - ${center.field.x}px + ${arrange.new_field}rem) calc(50vh - ${center.field.y}px) 0`;

	// 答えのカード出現
	await animate(ele.field, [
		{
			opacity: 0,
			scale: 3
		},
		{
			opacity: 1,
			scale: 1.8
		},
	], 500);

	await new Promise((res) => setTimeout(res, 1000));

	if (renew.field !== 1) ele.field.classList.remove('display');
	// 場のカードを戻す
	animate(ele.field,
		renew.field === 1
			? {
				translate: `calc(50vw - ${center.field.x}px + ${arrange.new_field}rem) calc(-50vh - ${center.field.y}px) 0`
			}
			: {
				translate: '0 0 0',
				scale: 1
			},
		renew.field === 1 ? 700 : 500).then(() => {
			ele.field.removeAttribute('style');
			if (renew.field === 1) ele.field.style.visibility = 'hidden';
		});

	// 手札のカードを消す
	await Promise.all(
		['dummy', ...rest].map((key) =>
			animate(ele[key], {
				scale: 0,
				opacity: 0
			}, 300)
		)
	);

	ele.dummy.style.display = 'none';

	for (const key of rest)
		ele[key].classList.remove('display');

	displayOperator(index.op, game.ops[renew.op].name);
	if (index.num !== -1) ele.num.textContent = `${renew.num}`;

	ele.apply.classList.add('invalid');

	// 手札のカードを再出現
	await Promise.all(
		rest.map((key) => {
			ele[key].style.translate = '0 0 0';
			return animate(ele[key], [
				{
					scale: 0,
					opacity: 0
				},
				{
					scale: 1,
					opacity: 1
				}
			], 200);
		})
	);

	['dummy', ...rest].forEach((key) => {
		ele[key].removeAttribute('style');
	});

	if (game.cleared) {
		const modal = document.getElementById('clear');
		modal.style.opacity = 1;
		modal.style.scale = 1;
	}
}

function displayOperator(index, name) {
	const ele = cards.op[index];
	ele.textContent = '';
	switch (name) {
		case 'pop':
			ele.insertAdjacentHTML('afterbegin', '<span style="font-size: 1.8rem">Popcount</span>');
			break;
		case 'd':
			ele.insertAdjacentHTML('afterbegin', '<span style="font-size: 1.6rem">の約数の数</span>');
			break;
		case 'gcd':
			ele.insertAdjacentHTML('afterbegin', '<span style="font-size: 1.4rem">の最大公約数</span>');
			break;
		default:
			ele.textContent = {
				add: '+', sub: '-', mul: '×', div: '÷', rem: '%',
				and: '&', or: '|', xor: '^',
				root: '√'
			}[name];
			break;
	}
}

function init() {
	State.oninit = (key, index, value) => {
		if (key === 'op') displayOperator(index, game.ops[value].name);
		else cards[key][index].textContent = `${value}`;
	}

	State.onfocus = (key, index) => cards[key][index].classList.add('chosen');
	State.onunfocus = (key, index) => cards[key][index].classList.remove('chosen');
	State.onenabled = (key, index) => cards[key][index].classList.remove('invalid');
	State.ondisabled = (key, index) => cards[key][index].classList.add('invalid');

	document.getElementById('retry').addEventListener('click', () => start(2));
	document.getElementById('return').addEventListener('click', () => location.replace('../../home/page/home.html'));
}

async function start(level) {
	for (const key in cards)
		for (const card of cards[key])
			card.removeAttribute('style');
	document.getElementById('clear').removeAttribute('style');

	document.getElementById('title').textContent = `Level ${level}`;

	game = new Game(level);

	game.onapply = async (...args) => {
		game.block();

		await applyAnimation(...args);

		if (!game.cleared) game.accept();
	};

	await startAnimation();
	game.accept();
}

init();
const params = new URLSearchParams(window.location.search);
const level = params.get('level');
const rule = params.get('rule');
start(level);
