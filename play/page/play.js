class Game {
	static OP = [
		{ call: (f, p) => f + p, param: true },
		{ call: (f, p) => (f - p), param: true },
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
		}

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
			{ ...this.chosen }
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

	click(name, index) {
		if (!this.input) return;

		if (this.chosen[name] === index) index = -1;

		if (this.chosen[name] !== -1) this.onunfocus(name, this.chosen[name]);
		if (index !== -1) this.onfocus(name, index);

		this.chosen[name] = index;
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

async function applyAnimation(value, index) {
	game.block();

	const getCenter = (ele) => {
		const rect = ele.getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	}

	const ele = Object.keys(index).reduce((acc, key) => ({ ...acc, [key]: cards[key][index[key]] }), { body: document.body, apply: cards.apply });
	const center = Object.keys(ele).reduce((acc, key) => ({ ...acc, [key]: getCenter(ele[key]) }), {});

	ele.dummy = cards.dummy;

	ele.apply.classList.add('chosen');

	for (const key in ele)
		ele[key].style.zIndex = 1;

	await Promise.all(
		['field', 'op', 'num', 'apply'].map((name, i) =>
			ele[name].animate(
				{
					translate: `calc(${center.body.x - center[name].x}px + ${20 * (i - 2) - 5}rem) ${center.body.y - center[name].y}px`,
					scale: (name === 'field' ? 2 / 3 : 1) * 1.5
				},
				{
					duration: 500,
					fill: 'forwards',
					easing: 'ease-out'
				}
			).finished
		)
	);

	Object.assign(ele.dummy.style, {
		display: 'flex',
		left: `calc(${center.body.x}px - 45rem) `,
		top: `${center.body.y}px`,
		translate: '-50% -50%',
		scale: 1.5
	});
	ele.dummy.textContent = ele.field.textContent;

	ele.field.textContent = `${value.field}`;
	ele.field.getAnimations().forEach((anime) => anime.cancel());
	ele.field.style.translate = `calc(${center.body.x - center.field.x}px + 40rem) ${center.body.y - center.field.y}px`;

	await ele.field.animate(
		[
			{
				opacity: 0,
				scale: 2.5
			},
			{
				opacity: 1,
				scale: 1.8
			},
		],
		{
			duration: 500,
			fill: 'forwards',
			easing: 'ease-out'
		}
	).finished;

	await new Promise((res) => setTimeout(res, 500));

	ele.field.classList.remove('chosen')
	ele.field.animate(
		{
			translate: '0 0',
			scale: 1
		},
		{
			duration: 500,
			fill: 'forwards',
			easing: 'ease-out'
		}
	).finished.then(() => {
		ele.field.getAnimations().forEach((anime) => anime.cancel());
		ele.field.removeAttribute('style');

		game.accept();
	});

	await Promise.all(
		['dummy', 'op', 'num', 'apply'].map((name) =>
			ele[name].animate(
				{
					scale: 0,
					opacity: 0
				},
				{
					duration: 500,
					fill: 'forwards',
					easing: 'ease-out'
				}
			).finished
		)
	);

	ele.dummy.getAnimations().forEach((anime) => anime.cancel());
	ele.dummy.style.display = 'none';

	displayOperator(index.op, value.op);
	ele.num.textContent = `${value.num}`;

	ele.op.classList.remove('chosen');
	ele.num.classList.remove('chosen');
	ele.apply.classList.remove('chosen');

	await Promise.all(
		['op', 'num', 'apply'].map((name) => {
			ele[name].getAnimations().forEach((anime) => anime.cancel());
			return ele[name].animate(
				[
					{
						scale: 0,
						opacity: 0
					},
					{
						scale: 1,
						opacity: 1
					}
				],
				{
					duration: 100,
					fill: 'forwards',
					easing: 'ease-out'
				}
			).finished;
		})
	);

	['op', 'num', 'apply'].map((name) => {
		ele[name].getAnimations().forEach((anime) => anime.cancel());
		ele[name].removeAttribute('style');
	})
}

function displayOperator(index, value) {
	cards.op[index].textContent = ['+', '-', '*', '/', '%', '&', '|', '^'][value];
}

function start() {
	game = new Game(0);

	game.oninit = (name, index, value) => {
		if (name === 'op') displayOperator(index, value);
		else cards[name][index].textContent = `${value}`;
	};

	game.onfocus = (name, index) => cards[name][index].classList.add('chosen');
	game.onunfocus = (name, index) => cards[name][index].classList.remove('chosen');
	game.onapply = applyAnimation;

	game.init();
}

start();