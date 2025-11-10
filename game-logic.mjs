const gcd = (a, b) => a % b ? gcd(b, a % b) : b;

// 演算選択用の重み付き乱数
export class WeightRandom {
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
export class State {
	constructor(key, n, create, game, double = false) {
		this.count = n;
		n = double ? n * 2 : n;
		this.key = key;
		this.values = [...Array(n)].map(() => create());
		this.valid = Array(n).fill(true);
		this.chosen = -1;
		this.create = create;
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
		this.chosen = n;
	}
	unfocus(n) {
		// This is a placeholder, as the original was UI-related.
	}
	// isValid(value)がtrueのカードのみ有効にする
	filter(isValid) {
		this.values.forEach((value, i) => {
			const valid = i >= this.count || (isValid ? isValid(value) : true);
			this.valid[i] = valid;
			if (!valid && this.chosen === i) {
				this.focus(-1);
			}
		});
	}
}

// 演算子の定義をまとめる
export class Op {
	static list = [
		new Op('add', (f, p) => f + p),
		new Op('sub', (f, p) => Math.abs(f - p)),
		new Op('mul', (f, p) => f * p),
		new Op('div', (f, p) => Math.floor(f / p), { isPValid: (p) => p != 0 }),
		new Op('rem', (f, p) => f % p, { isPValid: (p) => p !== 0 }),
		new Op('and', (f, p) => f & p),
		new Op('or', (f, p) => f | p),
		new Op('xor', (f, p) => f ^ p),
		new Op('pop', (f) => {
			let c = 0;
			while (f != 0) { c += f % 2; f >>= 1; }
			return c;
		}, { r_param: false }),
		new Op('root', (f) => Math.floor(Math.sqrt(f)), { r_param: false }),
		new Op('d', (f) => {
			let c = 0;
			for (let i = 1; i <= f; i++) if (f % i == 0) c++;
			return c;
		}, { r_param: false, isFValid: (f) => f !== 0 }),
		new Op('gcd', (f, p) => gcd(f, p), { isFValid: (f) => f !== 0, isPValid: (p) => p !== 0 })
	];

	constructor(name, calc, option = {}) {
		this.name = name;
		this.calc = calc;
		this.r_param = option.r_param ?? true;
		this.isFValid = option.isFValid ?? (() => true);
		this.isPValid = this.r_param ? (option.isPValid ?? (() => true)) : () => false;
	}
}

export class Game {
	constructor(level, rule) {
		this.level = level;
		this.rule = rule;
		this.moves = 0;

		const easyOps = ['add', 'sub', 'mul', 'div'];
		const normalOps = ['rem', 'root', 'd', 'gcd'];
		const hardOps = ['and', 'or', 'xor', 'pop'];

		let enabledOps = [];
		switch (level) {
			case 'easy': enabledOps = easyOps; break;
			case 'normal': enabledOps = [...easyOps, ...normalOps]; break;
			case 'hard': enabledOps = [...easyOps, ...normalOps, ...hardOps]; break;
			default: enabledOps = easyOps;
		}

		this.ops = Op.list.filter(op => enabledOps.includes(op.name));
        this.opgen = new WeightRandom(getOpPriority(level, this.ops));


		this.state = {
			field: new State('field', 6, () => Math.floor(Math.random() * 18 + 2)),
			num: new State('num', 4, () => Math.floor(Math.random() * 6)),
			op: new State('op', 4, () => this.ops[Math.floor(Math.random() * this.ops.length)]),
			apply: new State('apply', 1, () => '=')
		};
	}

	// 演算開始
	apply() {
		if (!this.valid) return false;

		const field = this.state.field.value;
		const op = this.state.op.value;
		const num = this.state.num.value;

		this.state.field.make(op.calc(field, num));
		this.state.op.make(this.ops[this.opgen.get()]);
		this.state.num.make();

		this.state.field.focus(-1);
		this.state.op.focus(-1);
		this.state.num.focus(-1);
		this.moves++;
        return true;
	}

	// 演算を開始できるか
	get valid() {
		if (this.state.field.value === null) return false;
		if (this.state.op.value === null) return false;
		if (!this.state.op.value.r_param) return true;
		return this.state.num.value !== null;
	}

	click(key, index) {
		switch (key) {
			case 'field':
				this.state.field.focus(index);
				break;
			case 'op':
				this.state.op.focus(index);
				if (this.state.op.value) {
					this.state.field.filter(this.state.op.value.isFValid);
					this.state.num.filter(this.state.op.value.isPValid);
				}
				break;
			case 'num':
				this.state.num.focus(index);
				break;
		}
	}

	get cleared() {
		return this.state.field.values.every((value) => value === 1);
	}

    get failed() {
        // In solo mode, there is no fail condition in the original logic.
        // This can be expanded for battle mode later.
        return false;
    }
}

// Helper function, also exported for potential use.
export function getOpPriority(level, availableOps) {
    const priorities = {
        'easy':   { 'add': 1, 'sub': 1, 'mul': 1, 'div': 1 },
        'normal': { 'add': 1, 'sub': 1, 'mul': 1, 'div': 1, 'rem': 1, 'root': 1, 'd': 1, 'gcd': 1 },
        'hard':   { 'add': 1, 'sub': 1, 'mul': 1, 'div': 1, 'rem': 1, 'and': 1, 'or': 1, 'xor': 1, 'pop': 1 }
    };
    const levelPriorities = priorities[level] || priorities['easy'];
    return availableOps.map(op => levelPriorities[op.name] || 0);
}
