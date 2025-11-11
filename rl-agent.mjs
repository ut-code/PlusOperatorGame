import { Game } from './game-logic.mjs';


// Q学習エージェント
export class QLearningAgent {
    constructor(actions, learningRate = 0.1, discountFactor = 0.9, explorationRate = 1.0) {
        this.qTable = new Map(); // Qテーブル { state_key: Map({ action_key: q_value }) }
        this.actions = actions; // 取りうる行動のリスト
        this.alpha = learningRate; // 学習率
        this.gamma = discountFactor; // 割引率
        this.epsilon = explorationRate; // 探索率
        this.minEpsilon = 0.01; // 探索率の最小値
        this.decayRate = 0.9995; // 探索率の減衰率
    }

    /**
     * 状態をユニークな文字列キーに変換する
     * @param {Game.state} state - ゲームの状態オブジェクト
     * @returns {string}
     */
    getStateKey(state) {
        const field = state.field.values.join(',');
        const ops = state.op.values.map(op => op.name).join(',');
        const nums = state.num.values.join(',');
        return `F:${field}|O:${ops}|N:${nums}`;
    }

    /**
     * 行動をユニークな文字列キーに変換する
     * @param {object} action - { field: index, op: index, num: index }
     * @returns {string}
     */
    getActionKey(action) {
        return `F${action.field}O${action.op}N${action.num}`;
    }

    /**
     * QテーブルからQ値を取得する。存在しない場合は0を返す。
     * @param {string} stateKey 
     * @param {string} actionKey 
     * @returns {number}
     */
    getQValue(stateKey, actionKey) {
        if (!this.qTable.has(stateKey)) {
            this.qTable.set(stateKey, new Map());
        }
        if (!this.qTable.get(stateKey).has(actionKey)) {
            this.qTable.get(stateKey).set(actionKey, 0);
        }
        return this.qTable.get(stateKey).get(actionKey);
    }

    /**
     * ε-greedy法に基づいて行動を選択する
     * @param {string} stateKey 
     * @returns {object} 選択された行動
     */
    chooseAction(stateKey) {
        // 探索 (Exploration)
        if (Math.random() < this.epsilon) {
            return this.actions[Math.floor(Math.random() * this.actions.length)];
        }
        
        // 活用 (Exploitation)
        const actionValues = this.qTable.get(stateKey) || new Map();
        let bestAction = this.actions[0];
        let maxQ = -Infinity;

        for (const action of this.actions) {
            const actionKey = this.getActionKey(action);
            const qValue = actionValues.get(actionKey) || 0;
            if (qValue > maxQ) {
                maxQ = qValue;
                bestAction = action;
            }
        }
        return bestAction;
    }

    /**
     * Q値を更新する
     * @param {string} stateKey 
     * @param {string} actionKey 
     * @param {number} reward 
     * @param {string} nextStateKey 
     */
    learn(stateKey, actionKey, reward, nextStateKey) {
        const oldQ = this.getQValue(stateKey, actionKey);
        
        const nextActionValues = this.qTable.get(nextStateKey) || new Map();
        let maxNextQ = 0;
        if (nextActionValues.size > 0) {
            maxNextQ = Math.max(...nextActionValues.values());
        }

        // Q学習の更新式
        const newQ = oldQ + this.alpha * (reward + this.gamma * maxNextQ - oldQ);
        this.qTable.get(stateKey).set(actionKey, newQ);
    }

    /**
     * 探索率を減衰させる
     */
    decayEpsilon() {
        if (this.epsilon > this.minEpsilon) {
            this.epsilon *= this.decayRate;
        }
    }
}
