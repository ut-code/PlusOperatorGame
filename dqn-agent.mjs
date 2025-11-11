import * as tf from '@tensorflow/tfjs';

// +++ Prioritized Replay Buffer +++
class PrioritizedReplayBuffer {
  constructor(capacity, alpha = 0.6) {
    this.capacity = capacity;
    this.alpha = alpha;
    this.buffer = [];
    this.priorities = [];
    this.position = 0;
    this.PER_e = 1e-5; // Epsilon to ensure no priority is zero
  }

  add(experience) {
    const maxPriority = this.priorities.length > 0 ? Math.max(...this.priorities) : 1.0;
    
    if (this.buffer.length < this.capacity) {
      this.buffer.push(experience);
      this.priorities.push(maxPriority);
    } else {
      this.buffer[this.position] = experience;
      this.priorities[this.position] = maxPriority;
    }
    this.position = (this.position + 1) % this.capacity;
  }

  sample(batchSize, beta = 0.4) {
    const scaledPriorities = this.priorities.map(p => Math.pow(p, this.alpha));
    const prioSum = scaledPriorities.reduce((a, b) => a + b, 0);
    const probabilities = scaledPriorities.map(p => p / prioSum);

    const sampleIndices = [];
    const sampleExperiences = [];
    const sampleWeights = [];

    for (let i = 0; i < batchSize; i++) {
      // Using probabilities to sample (can be slow, but simple to implement)
      const rand = Math.random();
      let cumulativeProb = 0;
      let sampleIndex = -1;
      for (let j = 0; j < probabilities.length; j++) {
        cumulativeProb += probabilities[j];
        if (rand <= cumulativeProb) {
          sampleIndex = j;
          break;
        }
      }
      if (sampleIndex === -1) sampleIndex = this.buffer.length - 1;

      sampleIndices.push(sampleIndex);
      sampleExperiences.push(this.buffer[sampleIndex]);
      
      // Calculate Importance Sampling (IS) weight
      const weight = Math.pow(this.buffer.length * probabilities[sampleIndex], -beta);
      sampleWeights.push(weight);
    }

    // Normalize weights by the maximum weight in the batch
    const maxWeight = Math.max(...sampleWeights);
    const normalizedWeights = sampleWeights.map(w => w / maxWeight);

    return {
      experiences: sampleExperiences,
      indices: sampleIndices,
      weights: tf.tensor1d(normalizedWeights)
    };
  }

  updatePriorities(indices, tdErrors) {
    for (let i = 0; i < indices.length; i++) {
      const priority = Math.abs(tdErrors[i]) + this.PER_e;
      this.priorities[indices[i]] = priority;
    }
  }

  get length() {
    return this.buffer.length;
  }
}


export class DQNAgent {
  constructor(model, targetModel, replayBufferCapacity, actions, opList, gamma = 0.95, epsilon = 1.0, minEpsilon = 0.01, epsilonDecay = 0.995, learningRate = 0.001) {
    this.model = model;
    this.targetModel = targetModel;
    // Use PrioritizedReplayBuffer
    this.replayBuffer = new PrioritizedReplayBuffer(replayBufferCapacity);
    this.actions = actions;
    this.opList = opList;
    this.gamma = gamma;
    this.epsilon = epsilon;
    this.minEpsilon = minEpsilon;
    this.epsilonDecay = epsilonDecay;
    this.optimizer = tf.train.adam(learningRate);

    this.opMap = new Map();
    this.opList.forEach((op, index) => {
      this.opMap.set(op.name, index);
    });
    this.opVectorSize = this.opList.length;
  }

  /**
   * 状態オブジェクトを固定長の数値ベクトル（テンソル）に変換する
   * @param {object} state - game.state オブジェクト
   * @returns {tf.Tensor}
   */
  stateToVector(state) {
    const vector = [];

    // 1. Field (6次元) - 例: 500で正規化 (より大きなスケールに対応)
    for (const value of state.field.values) {
      vector.push(value / 500.0); 
    }

    // 2. Num (4次元) - 例: 5で正規化
    for (const value of state.num.values) {
      vector.push(value / 5.0);
    }

    // 3. Op (4スロット * 12次元 = 48次元)
    for (const op of state.op.values) {
      // this.opVectorSize (12) の長さの 0埋め配列を作成
      const opVector = new Array(this.opVectorSize).fill(0);
      
      // this.opMap を使って対応するインデックスを取得
      if (this.opMap.has(op.name)) {
        const index = this.opMap.get(op.name);
        opVector[index] = 1; // 該当箇所を 1 にする (One-hot)
      }
      
      vector.push(...opVector);
    }

    // tf.tensor2d に変換 (バッチサイズ 1, stateSize)
    return tf.tensor2d([vector]);
  }

  chooseAction(state, game) {
    const validMask = this.getValidActionMask(state, game);
    
    if (Math.random() <= this.epsilon) {
      // 有効な行動の中からランダムに選択
      const validIndices = validMask
        .map((valid, idx) => valid ? idx : -1)
        .filter(idx => idx !== -1);
      if (validIndices.length === 0) {
        console.warn("No valid actions available!");
        return 0; // フォールバック
      }
      return validIndices[Math.floor(Math.random() * validIndices.length)];
    }
    
    const stateVector = this.stateToVector(state);
    const qValues = this.model.predict(stateVector).dataSync();
    
    // 無効な行動のQ値を-∞にする
    const maskedQValues = qValues.map((q, idx) => 
      validMask[idx] ? q : -Infinity
    );
    
    // 最大Q値の行動を選択
    return maskedQValues.indexOf(Math.max(...maskedQValues));
  }

  remember(state, action, reward, nextState, done) {
    this.replayBuffer.add({ state, action, reward, nextState, done });
  }

  async replay(batchSize, beta) {
    if (this.replayBuffer.length < batchSize) {
      return { loss: 0 }; // Return zero loss if not enough samples
    }

    const { experiences, indices, weights } = this.replayBuffer.sample(batchSize, beta);
    
    const states = experiences.map(exp => this.stateToVector(exp.state).dataSync());
    const nextStates = experiences.map(exp => this.stateToVector(exp.nextState).dataSync());

    const statesTensor = tf.tensor2d(states, [batchSize, this.model.input.shape[1]]);
    const nextStatesTensor = tf.tensor2d(nextStates, [batchSize, this.model.input.shape[1]]);

    // Predict Q-values for next states using the target model
    const nextQValues = this.targetModel.predict(nextStatesTensor).arraySync();
    
    // Calculate target Q-values
    const targets = experiences.map((exp, i) => {
      let target = exp.reward;
      if (!exp.done) {
        target = exp.reward + this.gamma * Math.max(...nextQValues[i]);
      }
      return target;
    });

    // Use tf.tidy to manage memory
    let loss;
    tf.tidy(() => {
        const {value: lossValue, grads} = this.optimizer.computeGradients(() => {
            const qValues = this.model.apply(statesTensor); // Get Q-values for current states
            
            // Gather the Q-values for the actions that were actually taken
            const actionIndices = experiences.map(exp => exp.action);
            const qValuesForActions = qValues.mul(tf.oneHot(tf.tensor1d(actionIndices, 'int32'), this.actions.length)).sum(-1);

            // Calculate TD errors for priority updates
            const tdErrorsTensor = tf.sub(tf.tensor1d(targets), qValuesForActions);
            
            // Calculate weighted loss
            const weightedSquaredError = tf.mul(weights, tf.square(tdErrorsTensor));
            const currentLoss = tf.mean(weightedSquaredError);
            
            // Update priorities outside the gradient calculation
            tf.dispose(tdErrorsTensor); // Dispose tensor to avoid memory leak
            const tdErrors = tf.sub(tf.tensor1d(targets), qValuesForActions).dataSync();
            this.replayBuffer.updatePriorities(indices, tdErrors);

            return {value: currentLoss};
        });

        this.optimizer.applyGradients(grads);
        loss = lossValue.dataSync()[0];
        tf.dispose(grads);
        tf.dispose(lossValue);
    });


    if (this.epsilon > this.minEpsilon) {
      this.epsilon *= this.epsilonDecay;
    }
    
    return { loss };
  }

  updateTargetModel() {
    this.targetModel.setWeights(this.model.getWeights());
  }

  getValidActionMask(state, game) {
      const mask = new Array(this.actions.length).fill(false);
      
      for (let i = 0; i < this.actions.length; i++) {
          const action = this.actions[i];
          const field = state.field.values[action.field];
          const op = state.op.values[action.op];
          const num = state.num.values[action.num];
          
          if (!op.r_param) {
              mask[i] = op.isFValid(field);
          } else {
              mask[i] = op.isFValid(field) && op.isPValid(num);
          }
      }
      
      return mask;
  }

}