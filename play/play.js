let qTable = {};
const params = new URLSearchParams(window.location.search);
const level = params.get('level') || 'easy';
const rule = params.get('rule') || 'solo';

const FIELD_COUNT = 6, OP_COUNT = 4, NUM_COUNT = 4;

// QテーブルからCPUの状態キーを生成する
function getStateKeyForCPU(state) {
    // AIモデルはプレイヤー視点（最初の6,4,4個の要素）で学習されているため、
    // CPU（敵）の状態をプレイヤー視点に変換してQテーブルを引く
    const field = state.field.values.slice(FIELD_COUNT).join(',');
    const ops = state.op.values.slice(OP_COUNT).map(opIdx => game.ops[opIdx]?.name || 'unknown').join(',');
    const nums = state.num.values.slice(NUM_COUNT).join(',');
    return `F:${field}|O:${ops}|N:${nums}`;
}


// 演算選択用の重み付き乱数
class WeightRandom {
	#weight;
	constructor(weight) {
		// weight: 各添え字の値の重み
		this.#weight = [...weight];
		for (let i = 1; i < this.#weight.length; i++)
			this.#weight[i] += this.#weight[i - 1];
	}
	get() {
		const rand = Math.random() * this.#weight.at(-1);
		return this.#weight.findIndex((v) => v > rand);
	}
}

// 手札・場のカードの状態管理
class State {
	static oninit = () => { };
	static onfocus = () => { };
	static onunfocus = () => { };
	static onenabled = () => { };
	static ondisabled = () => { };

	constructor(key, n, create, game, double = false) {
		this.count = n;
		n = double ? n * 2 : n;
		this.key = key;
		this.values = [...Array(n)].map(() => create());
		this.valid = Array(n).fill(true);
		this.chosen = -1;
		this.create = create;

		this.values.forEach((value, index) => State.oninit(this.key, index, value, game));
	}
	// 選択中の値 or null
	get value() {
		if (this.chosen === -1) return null;
		return this.values[this.chosen];
	}
	// 選択中の値と添え字
	get info() {
		return {
			value: this.value,
			index: this.chosen
		};
	}
	// 新しい値で埋める
	make(value) {
		if (this.chosen === -1) return;
		this.values[this.chosen] = value ?? this.create();
	}
	// n番目を選択状態に
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
	// isValid(value)がtrueのカードのみ有効にする
	filter(isValid) {
		this.values.forEach((value, i) => {
			const valid = i >= this.count || (isValid ? isValid(value) : true);
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

// 演算子の定義をまとめる
class Op {
	// [演算子名, 演算関数(field, param), {
	//     wrap: カード配置を変更する場合のラッパー,
	//     isFValid: 場のカードが有効か判定する,
	//     isPValid: 手札の数字カードが有効か判定する
	//}]
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
	//カードが中央に集まるときの配置を設定
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

	constructor(level, rule) {
		this.level = level;
		this.rule = rule;
		this.moves = 0;

		this.opgen = new WeightRandom(getOpPriority(level));

		const easyOps = ['add', 'sub', 'mul', 'div'];
		const normalOps = ['rem', 'root', 'd', 'gcd'];
		const hardOps = ['and', 'or', 'xor', 'pop'];

		let enabledOps = [];
		switch (level) {
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
			field: new State('field', FIELD_COUNT, () => Math.floor(Math.random() * 18 + 2), null, rule === 'battle'),
			num: new State('num', NUM_COUNT, () => Math.floor(Math.random() * 6), null, rule === 'battle'),
			op: new State('op', OP_COUNT, () => Math.floor(Math.random() * this.ops.length), this, rule === 'battle'),
			apply: new State('apply', 1, () => '=')
		};

		this.input = false;
	}

	// 演算開始
	apply() {
		if (!this.valid) return;

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
		this.moves++;
	}

	// カード選択を有効化 / 無効化
	accept() {
		this.input = true;
		document.body.classList.remove('is-animating');
	}
	block() {
		this.input = false;
		document.body.classList.add('is-animating');
	}

	// 演算を開始できるか
	get valid() {
		if (this.state.field.value === null) return false;
		if (this.state.op.value === null) return false;
		if (!this.ops[this.state.op.value].r_param) return true;
		return this.state.num.value !== null;
	}

	click(key, index) {
		switch (key) {
			case 'field':
				this.state.field.focus(index);
				break;
			case 'op':
				this.state.op.focus(index);
				if (index < OP_COUNT) {
					this.state.field.filter(this.ops[this.state.op.value]?.isFValid);
					this.state.num.filter(this.ops[this.state.op.value]?.isPValid);
				}
				break;
			case 'num':
				this.state.num.focus(index);
				break;
		}

		this.state.apply.filter(() => this.valid);
	}

	get cleared() {
		const values = this.state.field.values;
		if (this.rule === 'solo')
			return values.find((value) => value != 1) === undefined;
		else
			return values.slice(0, values.length / 2).find((value) => value != 1) === undefined;
	}
	get failed() {
		const values = this.state.field.values;
		if (this.rule === 'solo') return false;
		else
			return values.slice(values.length / 2).find((value) => value != 1) === undefined;
	}
}

var game;

// 対戦相手の手を設定
function moveCPU() {
    const stateKey = getStateKeyForCPU(game.state);
    const validActions = qTable[stateKey];
    let action = null;

    if (validActions && Object.keys(validActions).length > 0) {
        let bestQ = -Infinity;
        let bestActionKey = '';
        for (const actionKey in validActions) {
            if (validActions[actionKey] > bestQ) {
                bestQ = validActions[actionKey];
                bestActionKey = actionKey;
            }
        }
        const match = bestActionKey.match(/F(\d+)O(\d+)N(\d+)/);
        if (match) {
            action = { field: parseInt(match[1]), op: parseInt(match[2]), num: parseInt(match[3]) };
        }
    }

    // Qテーブルにない状態か、有効なアクションがない場合はランダムに行動
    if (!action) {
        action = {
            field: Math.floor(Math.random() * FIELD_COUNT),
            op: Math.floor(Math.random() * OP_COUNT),
            num: Math.floor(Math.random() * NUM_COUNT)
        };
    }

    // `applyCPUAnimation`が期待する形式に変換する
    const cpuOpCardIndex = action.op + OP_COUNT;
    const opIndexInGameOps = game.state.op.values[cpuOpCardIndex];

    const cpuNumCardIndex = action.num + NUM_COUNT;
    const numValue = game.state.num.values[cpuNumCardIndex];

    const cpuFieldCardIndex = action.field + FIELD_COUNT;

    const move = {
        op: { index: cpuOpCardIndex, type: opIndexInGameOps },
        num: { index: cpuNumCardIndex, value: numValue },
        field: { index: cpuFieldCardIndex }
    };

    // 元のapplyCPUAnimationのロジックとの互換性のための状態更新
    game.state.op.values[move.op.index] = move.op.type;

    return move;
}


const cards = {
	field: [...document.querySelectorAll('#field>.card'), ...rule === 'battle' ? document.querySelectorAll('#enemy_field>.card') : []],
	op: [...document.querySelectorAll('#op>.card'), ...rule === 'battle' ? document.querySelectorAll('#enemy_op>.card') : []],
	num: [...document.querySelectorAll('#num>.card'), ...rule === 'battle' ? document.querySelectorAll('#enemy_num>.card') : []],
	apply: document.querySelectorAll('#apply'),
	dummy: document.querySelector('#dummy')
};

for (const key in cards) {
	if (key === 'dummy');
	else if (key === 'apply')
		cards.apply[0].addEventListener('click', () => {
			if (game.input) game.apply()
		});
	else
		cards[key].forEach((card, i) => {
			card.addEventListener('click', () => {
				if (!game.input) return;
				switch (key) {
					case 'field':
						game.click(key, i);
						break;
					case 'op':
						if (i < OP_COUNT)
							game.click(key, i);
						break;
					case 'num':
						if (i < NUM_COUNT)
							game.click(key, i);
						break;
				}
			})
		});
}

function setupDesign(rule) {
	switch (rule) {
		case 'solo':
			document.getElementById('enemy_field').style.display = 'none';
			document.getElementById('enemy_hand').style.display = 'none';
			break;
		case 'battle':
			document.documentElement.style.fontSize = 'min(0.6vh, 0.36vw)';
			break;
	}
}

async function animate(ele, keyframes, duration, delay = 0) {
	const anime = ele.animate(keyframes, {
		duration,
		delay,
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
		[...cards.field].map((ele, i) => {
			const index = game.rule === 'battle' ? i % FIELD_COUNT : i;
			return animate(ele, [
				{
					translate: `${(2.5 - index) * 10}rem -20rem 0`,
					opacity: 0
				},
				{
					translate: '0 0 0',
					opacity: 1
				}
			], 500, index * 20)
		})
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
		], 500, i * 20)),
		...[...cards.num].map((ele, i) => animate(ele, [
			{
				scale: 0,
				opacity: 0
			},
			{
				scale: 1,
				opacity: 1
			}
		], 500, (i + cards.op.length) * 20)),
	]);

	[...cards.op].forEach((ele) => ele.removeAttribute('style'));
	[...cards.num].forEach((ele) => ele.removeAttribute('style'));
}

async function applyAnimation(old, renew, index, user = true) {
	const getCenter = (ele) => {
		const rect = ele.getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	};

	const arrange = old.op.getArrange(old.field, old.num);
	const keys = Object.keys(arrange).filter((v) => v != 'new_field');
	const rest = keys.filter((v) => v != 'field');

	const ele = keys.reduce((acc, key) => ({ ...acc, [key]: cards[key][index[key]] }), { apply: cards.apply[0] });
	const center = Object.keys(ele).reduce((acc, key) => ({ ...acc, [key]: getCenter(ele[key]) }), {});

	ele.dummy = cards.dummy;

	for (const key of keys) {
		ele[key].style.zIndex = 1;
		ele[key].classList.add('display');
	}
	ele.field.style.zIndex = 2;

	const areaRect = document.getElementById('area').getBoundingClientRect();
	const areaCenterY = areaRect.top + areaRect.height / 2;

	// カードを中心に
	await Promise.all(
		keys.map((key, i) => {
			// HACK: applyボタンだけtransformYの補正が入っているため、その分を補正する
			const offsetY = key === 'apply' ? ele.apply.getBoundingClientRect().height / 4 : 0;
			return animate(ele[key], {
				translate: `calc(50vw - ${center[key].x}px + ${arrange[key]}rem) calc(${areaCenterY}px - ${center[key].y}px + ${offsetY}px) 0`,
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
	ele.field.style.translate = `calc(50vw - ${center.field.x}px + ${arrange.new_field}rem) calc(${areaCenterY}px - ${center.field.y}px) 0`;

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
	displayNumber(index.num, renew.num);

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
	// HACK: applyボタンのtransformを再適用
	ele.apply.style.transform = 'translateY(-50%)';

	if (game.cleared) {
		const modal = document.getElementById('clear');
		const movesDisplay = document.getElementById('clear-moves');
		movesDisplay.textContent = `手数：${game.moves} 回`;
		modal.style.opacity = 1;
		modal.style.scale = 1;
		return;
	}

	if (game.failed) {
	}

	if (game.rule === 'battle' && user) await applyCPUAnimation();
}

async function applyCPUAnimation() {
	const move = moveCPU(game);
	const field_value = game.state.field.values[move.field.index], op = game.ops[move.op.type];
	
	await new Promise((resolve) => setTimeout(resolve, 200));
	game.click('field', move.field.index);
	await new Promise((resolve) => setTimeout(resolve, 800));
	displayOperator(move.op.index, game.ops[move.op.type].name, false);
	game.click('op', move.op.index);
	await new Promise((resolve) => setTimeout(resolve, 800));
	if (op.r_param) {
		displayNumber(move.num.index, move.num.value, false)
		game.click('num', move.num.index);
		await new Promise((resolve) => setTimeout(resolve, 800));
	}

	game.state.field.values[move.field.index] = op.calc(field_value, move.num.value);

	game.state.field.focus(-1);
	game.state.op.focus(-1);
	game.state.num.focus(-1);
	//this.moves++;

	await applyAnimation(
		{ field: field_value, op: op, num: move.num.value },
		{ field: game.state.field.values[move.field.index], op: move.op.type, num: null },
		{ field: move.field.index, op: move.op.index, num: move.num.index, apply: 0 },
		false
	);
}
//CPUの手札を見るために一時的にhide=falseにしている。後で元に戻す
function displayOperator(index, name, hide = false) {
	if (index >= OP_COUNT && hide) name = 'hidden';

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
				root: '√', hidden: '?'
			}[name];
			break;
	}
}
//同上
function displayNumber(index, num, hide = false) {
	if (index === -1) return;
	if (index >= NUM_COUNT && hide) cards.num[index].textContent = '?';
	else cards.num[index].textContent = `${num}`;
}

// 演算子の優先順位
function getOpPriority(level) {
	// Op.listの順番に重みづけ
	switch (level) {
		case 'easy':
			return [1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0];
		case 'normal':
			return [1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1];
		case 'hard':
			return [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0];
		default:
			return [1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0];
	}
}

function init() {
	State.oninit = (key, index, value, game) => {
		switch (key) {
			case 'op':
				if (game && game.ops[value]) {
					displayOperator(index, game.ops[value].name);
				}
				break;
			case 'num':
				displayNumber(index, value);
				break;
			case 'field':
				cards[key][index].textContent = `${value}`;
				break;
		}
	}

	State.onfocus = (key, index) => cards[key][index].classList.add('chosen');
	State.onunfocus = (key, index) => cards[key][index].classList.remove('chosen');
	State.onenabled = (key, index) => cards[key][index].classList.remove('invalid');
	State.ondisabled = (key, index) => cards[key][index].classList.add('invalid');

	document.getElementById('retry').addEventListener('click', () => start(level, rule));
	document.getElementById('return').addEventListener('click', () => location.replace('../home/home.html'));
}

async function start(level, rule) {
	setupDesign(rule);

    try {
        const response = await fetch('/q-table.json');
        if (response.ok) {
            qTable = await response.json();
            console.log('Q-table loaded successfully.');
        } else {
            console.error('Failed to load Q-table. CPU will use random moves.');
        }
    } catch (error) {
        console.error('Error fetching Q-table:', error);
    }

	for (const key in cards) {
		if (key === 'dummy') continue; // 'dummy'キーの場合はスキップする
		for (const card of cards[key])
			card.removeAttribute('style');
	}
	document.getElementById('clear').removeAttribute('style');

	document.getElementById('title').textContent = `Level ${level.charAt(0).toUpperCase() + level.slice(1)}`;

	game = new Game(level, rule);

	game.onapply = async (...args) => {
		game.block();

		await applyAnimation(...args);

		if (!game.cleared) game.accept();
	};

	await startAnimation();
	game.accept();
}

var game;
init();
start(level, rule);