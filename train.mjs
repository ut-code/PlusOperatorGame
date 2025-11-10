import { Game } from './game-logic.mjs';
import { QLearningAgent } from './rl-agent.mjs';
import { writeFileSync } from 'fs';

const EPISODES = 20000; // 学習を行うゲーム回数
const LEVEL = 'easy';    // ゲームのレベル
const MAX_MOVES_PER_EPISODE = 100; // 1ゲームあたりの最大手数

// 1. 行動空間を定義する
const FIELD_COUNT = 6, OP_COUNT = 4, NUM_COUNT = 4;
const actions = [];
for (let i = 0; i < FIELD_COUNT; i++) {
    for (let j = 0; j < OP_COUNT; j++) {
        for (let k = 0; k < NUM_COUNT; k++) {
            actions.push({ field: i, op: j, num: k });
        }
    }
}

// 2. エージェントを初期化する
const agent = new QLearningAgent(actions);

// 3. 報酬を計算する関数
function calculateReward(game, oldFieldValues, moveSuccess) {
    if (!moveSuccess) {
        return -10; // 無効な手には大きなペナルティ
    }
    if (game.cleared) {
        return 100; // クリアしたら大きな報酬
    }

    // 中間報酬: ゴール（全フィールドが1）にどれだけ近づいたか
    const oldSum = oldFieldValues.reduce((a, b) => a + b, 0);
    const newSum = game.state.field.values.reduce((a, b) => a + b, 0);
    
    // 合計値が6に近づくほど報酬が高くなる
    const rewardForProgress = (oldSum - 6) - (newSum - 6);

    return rewardForProgress - 1; // 手数ペナルティ
}


// 4. 学習ループ
console.log('学習を開始します...');
for (let i = 0; i < EPISODES; i++) {
    let game = new Game(LEVEL, 'solo');
    let moves = 0;

    while (!game.cleared && moves < MAX_MOVES_PER_EPISODE) {
        const stateKey = agent.getStateKey(game.state);
        const action = agent.chooseAction(stateKey);
        
        const oldFieldValues = [...game.state.field.values];

        // アクションを実行
        game.click('field', action.field);
        game.click('op', action.op);
        game.click('num', action.num);
        const moveSuccess = game.apply();

        const reward = calculateReward(game, oldFieldValues, moveSuccess);
        const nextStateKey = agent.getStateKey(game.state);
        const actionKey = agent.getActionKey(action);

        agent.learn(stateKey, actionKey, reward, nextStateKey);
        
        moves++;
    }

    agent.decayEpsilon(); // エピソードごとに探索率を減衰

    if ((i + 1) % 1000 === 0) {
        console.log(`エピソード ${i + 1}/${EPISODES} 完了 (ε: ${agent.epsilon.toFixed(4)})`);
    }
}
console.log('学習が完了しました。');


// 5. QテーブルをJSONファイルに保存
console.log('Qテーブルを保存しています...');
const qTableForJson = {};
for (const [stateKey, actionMap] of agent.qTable.entries()) {
    qTableForJson[stateKey] = Object.fromEntries(actionMap);
}

try {
    writeFileSync('q-table.json', JSON.stringify(qTableForJson, null, 2));
    console.log('q-table.json にQテーブルを保存しました。');
} catch (err) {
    console.error('Qテーブルの保存に失敗しました:', err);
}
