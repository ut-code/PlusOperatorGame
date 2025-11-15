// game-wrapper.mjs (修正案)

import { Game, Op } from './game-logic.mjs';
// model-builder.mjs から状態サイズ計算をインポート [cite: 3]
import { calculateStateSize } from './model-builder.mjs'; 

export class GameWrapper {
  
  /**
   * コンストラクタを game-logic.mjs  (L95) と train.mjs (L32) に合わせる
   */
  constructor(difficulty, rule, maxFieldValue, maxSteps = 200) {
    this.difficulty = difficulty;
    this.rule = rule;
    this.maxFieldValue = maxFieldValue;
    this.maxSteps = maxSteps;
    
    // 6(field) * 4(op) * 4(num) = 96 通りのアクション空間を生成
    this._generateActions(); // this.actions が作成される

    this.reset();
  }

  /**
   * 6(field) * 4(op) * 4(num) = 96 通りのアクションを定義
   * dqn-agent.mjs (L300) の action 構造に対応
   */
  _generateActions() {
    this.actions = [];
    for (let f = 0; f < 6; f++) { // field (0-5)
      for (let o = 0; o < 4; o++) { // op (0-3)
        for (let n = 0; n < 4; n++) { // num (0-3)
          this.actions.push({ field: f, op: o, num: n });
        }
      }
    }
  }

  /**
   * 環境のリセット
   */
  reset() {
    // game-logic.mjs  (L95) のシグネチャに合わせる
    this.logic = new Game(this.difficulty, this.rule, this.maxFieldValue);
    this.steps = 0;
    this.totalReward = 0;
    return this.getState();
  }

  /**
   * アクションインデックスを受け取り、ゲームロジックを実行する
   */
  performAction(actionIndex) {
    const action = this.actions[actionIndex];
    if (!action) {
      console.warn(`Invalid actionIndex: ${actionIndex}`);
      return false; // 無効なアクション
    }

    // 1. game-logic  (L129) の click を呼び出す
    this.logic.click('field', action.field);
    this.logic.click('op', action.op);
    this.logic.click('num', action.num);

    // 2. game-logic  (L113) の apply を呼び出す
    // apply() は成功したら true を返す  (L113, L127)
    const success = this.logic.apply(); 
    
    return success;
  }

  /**
   * dqn-agent.mjs (L161) の stateToVector が期待する
   * state オブジェクト (state.field, state.num, state.op を持つ) を返す
   */
  getState() {
    return this.logic.state;
  }

  /**
   * 【報酬設計】ゴール（すべて1）からの距離（ポテンシャル）を計算
   */
  getPotential(state) {
    // state.field.values  (L27) のうち、ゲーム盤の6枚を参照
    return state.field.values.slice(0, 6).reduce((sum, value) => {
        // 値が発散しないよう、100でクリップ（上限設定）する
        const clampedValue = Math.min(value, 100); 
        // 1 との差の絶対値の合計 (L1ノルム)
        return sum + Math.abs(clampedValue - 1);
    }, 0);
  }

  /**
   * 【報酬設計】DQNエージェントがステップを実行する
   */
  step(actionIndex) {
    this.steps++;
    
    // 1. 行動前の状態とポテンシャルを記録
    const stateBefore = this.getState();
    const potentialBefore = this.getPotential(stateBefore);

    // 2. アクションを実行
    const actionSuccess = this.performAction(actionIndex);

    // 3. アクション後の状態を取得
    const stateAfter = this.getState();

    let reward = 0.0;
    let done = false;
    const info = {};

    // 4. アクションが無効だった場合のペナルティ
    if (!actionSuccess) {
      // (getValidActionMask (L297) が正しければ通らないが、安全策)
      reward = -1.0; // 無効な手には強いペナルティ
      done = false; // エピソードは継続
      info.reason = 'Invalid action attempted';

      this.totalReward += reward;
      return {
        state: stateAfter,
        reward: reward,
        done: done,
        info,
      };
    }

    // 5. 終了条件の判定 (疎な報酬)
    // ゲームクリア  (L139)
    if (this.logic.cleared) {
      reward = 20.0; // 成功の大きな報酬
      done = true;
      info.reason = 'Cleared';
    } 
    // タイムオーバー
    else if (this.steps >= this.maxSteps) {
      reward = -20.0; // 失敗の大きな報酬
      done = true;
      info.reason = 'Max steps reached';
    } 
    // 6. 中間ステップの報酬 (密な報酬 + ステップペナルティ)
    else {
      const potentialAfter = this.getPotential(stateAfter);
      
      // ポテンシャルの差 (ゴールにどれだけ近づいたか)
      const shapingReward = potentialBefore - potentialAfter;

      // 報酬のスケールを調整する係数
      const SHAPING_FACTOR = 0.1; 
      // 1手動かすごとにかかるコスト
      const STEP_PENALTY = -0.05; 

      reward = (shapingReward * SHAPING_FACTOR) + STEP_PENALTY;
      
      done = false;
    }

    this.totalReward += reward;

    return {
      state: stateAfter,
      reward: reward,
      done: done,
      info,
    };
  }

  // アクション空間のサイズ
  getActionSpaceSize() {
    return this.actions.length; // 96
  }

  // 状態空間のサイズ (model-builder.mjs [cite: 3] と連動)
  getStateSize() {
    // Op.list.length を calculateStateSize [cite: 3] (L18) に渡す
    return calculateStateSize(Op.list.length); 
  }
}