const params = new URLSearchParams(window.location.search);
const level = params.get('level') || 'easy';
const rule = params.get('rule') || 'solo';

const FIELD_COUNT = rule === 'solo' ? 6 : 4, OP_COUNT = 4, NUM_COUNT = 4;


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
			const valid = (this.key != 'field' && i >= this.count) || (isValid ? isValid(value) : true);
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
				field: -70,
				op: -40,
				num: -10,
				apply: 20,
				new_field: 60
			}
			: {
				field: -50,
				op: -20,
				apply: 10,
				new_field: 50
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

		this.ops = Op.list;

		this.state = {
			field: new State('field', FIELD_COUNT, () => Math.floor(Math.random() * 18 + 2), null, rule === 'battle'),
			num: new State('num', NUM_COUNT, () => Math.floor(Math.random() * 6), null, rule === 'battle'),
			op: new State('op', OP_COUNT, () => this.opgen.get(), this, rule === 'battle'),
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
		this.state.field.filter(() => true);

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
		if (this.rule === 'battle') {
			document.body.classList.remove('cpu-turn');
		}
		document.body.classList.add('player-turn');
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

// 対戦相手の手を設定 (Easy AI: ランダム)
function moveCPU_Easy() {
	// 1. 攻撃対象のフィールドをランダムに決定
	// 50%の確率で相手（プレイヤー）のフィールド、50%の確率で自分（CPU）のフィールド
	const attackPlayer = Math.random() < 0.5;

	let targetFieldCardIndex;
	if (attackPlayer) {
		// プレイヤーのフィールド (インデックス 0 から FIELD_COUNT - 1)
		targetFieldCardIndex = Math.floor(Math.random() * FIELD_COUNT);
	} else {
		// CPU自身のフィールド (インデックス FIELD_COUNT から FIELD_COUNT * 2 - 1)
		targetFieldCardIndex = Math.floor(Math.random() * FIELD_COUNT) + FIELD_COUNT;
	}

	// 2. CPUが使用するリソース（手札）をランダムに決定

	// CPUのop手札 (インデックス OP_COUNT から OP_COUNT * 2 - 1)
	const cpuOpLocalIndex = Math.floor(Math.random() * OP_COUNT);
	const cpuOpCardIndex = cpuOpLocalIndex + OP_COUNT;

	// CPUのnum手札 (インデックス NUM_COUNT から NUM_COUNT * 2 - 1)
	const cpuNumLocalIndex = Math.floor(Math.random() * NUM_COUNT);
	const cpuNumCardIndex = cpuNumLocalIndex + NUM_COUNT;


	// 3. `applyCPUAnimation`が期待する形式に変換する

	// 選択したopカードが示す、実際の演算（game.ops配列内のインデックス）
	const opIndexInGameOps = game.state.op.values[cpuOpCardIndex];

	// 選択したnumカードが示す、実際の数値
	const numValue = game.state.num.values[cpuNumCardIndex];

	// `applyCPUAnimation` 関数が期待する形式のオブジェクトを作成
	const move = {
		op: { index: cpuOpCardIndex, type: opIndexInGameOps }, // typeはgame.opsのインデックス
		num: { index: cpuNumCardIndex, value: numValue },      // valueは実際の数値
		field: { index: targetFieldCardIndex }                 // indexはグローバルインデックス (0-11)
	};

	return move;
}

// 対戦相手の手を設定 (Normal/Hard AI: 全探索)
function moveCPU_NormalHard() {
	let bestPlayerAttackMove = null;
	let maxPlayerScoreIncrease = -Infinity;

	let bestCpuDefenseMove = null;
	let maxCpuDistanceReduction = -Infinity;

	// すべての可能な手をループ
	// ループ1: CPUのop手札 (4枚)
	for (let opLocalIndex = 0; opLocalIndex < OP_COUNT; opLocalIndex++) {
		const cpuOpCardIndex = opLocalIndex + OP_COUNT;
		const opIndexInGameOps = game.state.op.values[cpuOpCardIndex];
		const opObject = game.ops[opIndexInGameOps];

		const numIterations = opObject.r_param ? NUM_COUNT : 1;

		// ループ2: CPUのnum手札
		for (let numLocalIndex = 0; numLocalIndex < numIterations; numLocalIndex++) {
			const cpuNumCardIndex = (opObject.r_param ? numLocalIndex : 0) + NUM_COUNT;
			const numValue = opObject.r_param ? game.state.num.values[cpuNumCardIndex] : null;

			// ループ3: 対象フィールド (全12枚)
			for (let targetFieldCardIndex = 0; targetFieldCardIndex < FIELD_COUNT * 2; targetFieldCardIndex++) {
				const fieldValue = game.state.field.values[targetFieldCardIndex];

				// 値が1のカードは選択対象外にする
				if (fieldValue === 1) {
					continue;
				}

				// 妥当性チェック
				if (!opObject.isFValid(fieldValue) || (opObject.r_param && !opObject.isPValid(numValue))) {
					continue;
				}

				const newValue = opObject.calc(fieldValue, numValue);
				const isPlayerField = targetFieldCardIndex < FIELD_COUNT;

				if (isPlayerField) {
					// プレイヤーの盤面を攻撃する手
					const scoreIncrease = newValue - fieldValue;
					if (scoreIncrease > maxPlayerScoreIncrease) {
						maxPlayerScoreIncrease = scoreIncrease;
						bestPlayerAttackMove = {
							op: { index: cpuOpCardIndex, type: opIndexInGameOps },
							num: { index: cpuNumCardIndex, value: numValue },
							field: { index: targetFieldCardIndex }
						};
					}
				} else {
					// CPU自身の盤面を改善する手
					const distanceReduction = Math.abs(fieldValue - 1) - Math.abs(newValue - 1);
					if (distanceReduction > maxCpuDistanceReduction) {
						maxCpuDistanceReduction = distanceReduction;
						bestCpuDefenseMove = {
							op: { index: cpuOpCardIndex, type: opIndexInGameOps },
							num: { index: cpuNumCardIndex, value: numValue },
							field: { index: targetFieldCardIndex }
						};
					}
				}
			}
		}
	}

	// 変化の大きい方を採用する
	// bestPlayerAttackMove と bestCpuDefenseMove のどちらか、または両方が null の場合がある
	if (bestPlayerAttackMove && bestCpuDefenseMove) {
		if (maxPlayerScoreIncrease > maxCpuDistanceReduction) {
			return bestPlayerAttackMove;
		} else {
			return bestCpuDefenseMove;
		}
	} else if (bestPlayerAttackMove) {
		return bestPlayerAttackMove;
	} else if (bestCpuDefenseMove) {
		return bestCpuDefenseMove;
	} else {
		// 有効な手が見つからなかった場合
		console.warn("CPU (Normal/Hard): 有効な手が見つかりませんでした。ランダムな手にフォールバックします。");
		return moveCPU_Easy();
	}
}


// CPUの行動を決定するメイン関数 (レベルに応じて分岐)
function moveCPU() {
	// グローバル変数 `level` を参照
	if (level === 'easy') {
		return moveCPU_Easy();
	} else {
		return moveCPU_NormalHard();
	}
}


const cards = {
	field: [...document.querySelectorAll('#field>.card'), ...rule === 'battle' ? document.querySelectorAll('#enemy_field>.card') : []],
	op: [...document.querySelectorAll('#op>.card'), ...rule === 'battle' ? document.querySelectorAll('#enemy_op>.card') : []],
	num: [...document.querySelectorAll('#num>.card'), ...rule === 'battle' ? document.querySelectorAll('#enemy_num>.card') : []],
	apply: document.querySelectorAll('#apply'),
	dummy: document.querySelector('#dummy')
};

// HACK: CPUモードで場の数を減らす
{
	cards.field.forEach((ele, index) => {
		if (index % 6 >= FIELD_COUNT) ele.style.display = 'none';
	})
	cards.field = cards.field.filter((_, index) => index % 6 < FIELD_COUNT);
}

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
			cards.apply[0].classList.add('battle');
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
					translate: `${(2.5 - index) * 5}rem -25rem 0`,
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
			return animate(ele[key], {
				translate: `calc(50vw - ${center[key].x}px + ${arrange[key]}rem) calc(${areaCenterY}px - ${center[key].y}px) 0`,
				scale: (key === 'field' ? 1 : (key === 'apply' ? 4 / 3 : 2))
			}, 500);
		})
	);

	await new Promise((resolve) => setTimeout(resolve, 200));

	// 両端のカード入れ替え
	if (index.field < FIELD_COUNT) ele.dummy.classList.remove('enemy');
	else ele.dummy.classList.add('enemy');
	Object.assign(ele.dummy.style, {
		display: 'flex',
		left: `calc(50vw + ${arrange.field}rem)`,
		top: `50vh`,
		translate: '-50% -50% 0',
		scale: 1
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

	await new Promise((res) => setTimeout(res, 1500));

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

	if (game.cleared || game.failed) {
		const modal = document.getElementById('clear');
		const clearDisplay = document.getElementById('clear-head');
		const movesDisplay = document.getElementById('clear-moves');
		const curtain = document.getElementById('curtain');
		clearDisplay.textContent = game.cleared ? (game.rule === 'battle' ? 'Win!' : 'Clear!') : 'Lose...';
		movesDisplay.textContent = `手数：${game.moves} 回`;
		modal.style.opacity = 1;
		modal.style.scale = 1;
		curtain.classList.add('display');
		return;
	}

	if (game.rule === 'battle' && user) {
		document.body.classList.remove('player-turn');
		document.body.classList.add('cpu-turn');
		cards.apply[0].classList.add('enemy');
		await applyCPUAnimation();
	}
	cards.apply[0].classList.remove('enemy');
}

async function applyCPUAnimation() {
	// moveCPUがレベルに応じた最適な手を返す
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

	// *** ここでCPUの手札を補充するロジックが必要 ***
	// プレイヤーの apply() メソッドを参考に、CPU側の手札を .make() する
	// (Stateクラスはchosen(選択中)のカードをmakeする仕様なので、
	//  CPUが使ったカードのインデックスを一時的にchosenに設定する必要がある)

	// 1. 選択状態を一時的にCPUが使ったカードに設定
	game.state.field.chosen = move.field.index;
	game.state.op.chosen = move.op.index;
	if (op.r_param) {
		game.state.num.chosen = move.num.index;
	}

	// 2. 計算結果をフィールドに反映 (make)
	const newValue = op.calc(field_value, move.num.value);
	game.state.field.make(newValue);

	// 3. CPUの手札を補充 (make)
	game.state.op.make(); // 新しいopを生成
	if (op.r_param) {
		game.state.num.make(); // 新しいnumを生成
	}

	// 4. 選択状態をリセット (重要)
	game.state.field.focus(-1);
	game.state.op.focus(-1);
	game.state.num.focus(-1);
	//this.moves++; // CPUのmovesをカウントする場合

	await applyAnimation(
		{ field: field_value, op: op, num: move.num.value },
		// renewの値は、State.oninit が参照できるように、make() で生成された後の値を使う
		{
			field: newValue,
			op: game.state.op.values[move.op.index], // 新しく生成されたop
			num: op.r_param ? game.state.num.values[move.num.index] : null // 新しく生成されたnum
		},
		{ field: move.field.index, op: move.op.index, num: move.num.index, apply: 0 },
		false
	);
}
function displayOperator(index, name, hide = true) {
	if (index >= OP_COUNT && hide) name = 'hidden';

	const ele = cards.op[index];
	ele.textContent = '';
	switch (name) {
		case 'pop':
			ele.insertAdjacentHTML('afterbegin', '<span style="font-size: 2rem">Popcount</span>');
			break;
		case 'd':
			ele.insertAdjacentHTML('afterbegin', '<span style="font-size: 2rem">の約数の数</span>');
			break;
		case 'gcd':
			ele.insertAdjacentHTML('afterbegin', '<span style="font-size: 1.7rem">の最大公約数</span>');
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
function displayNumber(index, num, hide = true) {
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
	document.getElementById('return').addEventListener('click', () => location.replace('../'));

	// Help button event listeners
	const helpButton = document.getElementById('help-button');
	const helpPopup = document.getElementById('help-popup');
	const closeHelp = document.getElementById('close-help');
	const dscrChange = document.getElementById('dscr-change');

	if (helpButton && helpPopup && closeHelp) {
		helpButton.addEventListener('click', () => {
			helpPopup.classList.add('show');
		});

		closeHelp.addEventListener('click', () => {
			helpPopup.classList.remove('show');
		});

		dscrChange.addEventListener('click', () => {
			helpPopup.classList.toggle('diff');
		});

		window.addEventListener('click', (event) => {
			if (event.target === helpPopup) {
				helpPopup.classList.remove('show');
			}
		});
	}
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

		if (!game.cleared && !game.failed) game.accept();
	};

	await startAnimation();
	game.accept();
}

var game;
init();
start(level, rule);