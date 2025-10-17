class Game {
	static OP = [
		{ call: (f, p) => f + p, param: true },
		{ call: (f, p) => Math.abs(f - p), param: true },
		{ call: (f, p) => (f * p), param: true },
		{ call: (f, p) => (Math.floor(f / p)), param: true },
		{ call: (f, p) => f % p, param: true },
		{ call: (f, p) => f & p, param: true },
		{ call: (f, p) => f | p, param: true },
		{ call: (f, p) => f ^ p, param: true },
	];

	oninit = () => { };
	onfocus = () => { };
	onunfocus = () => { };
	onapply = () => { };

	constructor(level) {
		this.level = level;
		this.value = {
			field: [...Array(4)].map(() => this.newFieldNum()),
			num: [...Array(4)].map(() => this.newHandNum()),
			op: [...Array(4)].map(() => this.newHandOp()),
		};

		this.chosen = {
			field: -1,
			op: -1,
			num: -1
		};

		this.input = true;
	}

	init() {
		for (const key in this.value)
			this.value[key].forEach((value, index) => this.oninit(key, index, value));
	}

	newFieldNum() {
		return Math.floor(Math.random() * 6);
	}

	newHandNum() {
		return Math.floor(Math.random() * 6);
	}

	newHandOp() {
		return Math.floor(Math.random() * Game.OP.length);
	}

	apply() {
		if (!this.input) return;

		const field = this.value.field[this.chosen.field],
			op = this.value.op[this.chosen.op],
			num = this.value.num[this.chosen.num];

		this.value.field[this.chosen.field] = Game.OP[op].call(field, num);

		this.value.num[this.chosen.num] = this.newHandNum();
		this.value.op[this.chosen.op] = this.newHandOp();

		this.onapply(
			Object.keys(this.value).reduce((acc, key) => ({ ...acc, [key]: this.value[key][this.chosen[key]] }), {}),
			{ ...this.chosen },
			op === 1 && field < num
		);

		for (const key in this.value) {
			this.chosen[key] = -1;
		}
	}

	accept() {
		this.input = true;
	}
	block() {
		this.input = false;
	}

	click(key, index) {
		if (!this.input) return;

		if (this.chosen[key] === index) index = -1;

		if (this.chosen[key] !== -1) this.onunfocus(key, this.chosen[key]);
		if (index !== -1) this.onfocus(key, index);

		this.chosen[key] = index;
	}

	get cleared() {
		return this.value.field.find((value) => value != 1) === undefined;
	}
}

var game;

const cards = {
	field: document.querySelectorAll('#field>.card'),
	op: document.querySelectorAll('#op>.card'),
	num: document.querySelectorAll('#num>.card'),
	apply: document.getElementById('apply'),
	dummy: document.getElementById('dummy')
};

for (const key in cards) {
	if (key === 'dummy');
	else if (key === 'apply')
		cards.apply.addEventListener('click', () => game.apply());
	else
		cards[key].forEach((card, i) => {
			card.addEventListener('click', () => game.click(key, i));
		});
}

async function animate(ele, keyframes, duration) {
	const anime = ele.animate(keyframes, {
		duration,
		fill: 'forwards',
		easing: 'ease-out'
	});
	await anime.finished;
	anime.commitStyles();
	anime.cancel();
}

async function applyAnimation(value, index, minus) {
	game.block();

	const getCenter = (ele) => {
		const rect = ele.getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	}

	const ele = Object.keys(index).reduce((acc, key) => ({ ...acc, [key]: cards[key][index[key]] }), { apply: cards.apply });
	const center = Object.keys(ele).reduce((acc, key) => ({ ...acc, [key]: getCenter(ele[key]) }), {});

	ele.dummy = cards.dummy;

	ele.apply.classList.add('chosen');

	for (const key in ele)
		ele[key].style.zIndex = 1;

	// カードを中心に
	await Promise.all(
		['field', 'op', 'num', 'apply'].map((key, i) => {
			let to = i;
			if (minus && (key == 'field' || key == 'num')) to = 2 - to;
			return animate(ele[key], {
				translate: `calc(50vw - ${center[key].x}px + ${20 * (to - 2) - 5}rem) calc(50vh - ${center[key].y}px)`,
				scale: (key === 'field' ? 2 / 3 : 1) * 1.5
			}, 500);
		})
	);

	// 両端のカード入れ替え
	Object.assign(ele.dummy.style, {
		display: 'flex',
		left: `calc(50vw - ${minus ? 5 : 45}rem) `,
		top: `50vh`,
		translate: '-50% -50%',
		scale: 1.5
	});
	ele.dummy.textContent = ele.field.textContent;

	ele.field.textContent = `${value.field}`;
	ele.field.style.translate = `calc(50vw - ${center.field.x}px + 40rem) calc(50vh - ${center.field.y}px)`;

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

	// 場のカードを戻す
	ele.field.classList.remove('chosen');

	animate(ele.field, [
		{
			scale: 1.8
		},
		{
			translate: value.field === 1
				? `calc(50vw - ${center.field.x}px + 40rem) calc(-50vh - ${center.field.y}px)`
				: '0 0',
			scale: 1
		}
	], 500).then(() => {
		ele.field.removeAttribute('style');

		if (value.field === 1) ele.field.style.visibility = 'hidden';

		game.accept();
	});

	// 手札のカードを消す
	await Promise.all(
		['dummy', 'op', 'num', 'apply'].map((key) =>
			animate(ele[key], {
				scale: 0,
				opacity: 0
			}, 300)
		)
	);

	ele.dummy.style.display = 'none';

	displayOperator(index.op, value.op);
	ele.num.textContent = `${value.num}`;

	// 手札のカードを再出現
	await Promise.all(
		['op', 'num', 'apply'].map((key) => {
			ele[key].style.translate = '0 0';
			ele[key].classList.remove('chosen');
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

	['op', 'num', 'apply', 'dummy'].forEach((key) => {
		ele[key].removeAttribute('style');
	});
}

function displayOperator(index, value) {
	cards.op[index].textContent = ['+', '-', '×', '÷', '%', '&', '|', '^'][value];
}

function start() {
	game = new Game(0);

	game.oninit = (key, index, value) => {
		if (key === 'op') displayOperator(index, value);
		else cards[key][index].textContent = `${value}`;
	};

	game.onfocus = (key, index) => cards[key][index].classList.add('chosen');
	game.onunfocus = (key, index) => cards[key][index].classList.remove('chosen');
	game.onapply = applyAnimation;

	game.init();
}

start();