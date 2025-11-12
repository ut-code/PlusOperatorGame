import * as tf from '@tensorflow/tfjs-node';

// +++ SumTree for efficient sampling +++
class SumTree {
  constructor(capacity) {
    this.capacity = capacity;
    this.tree = new Array(2 * capacity - 1).fill(0);
    this.data = new Array(capacity).fill(null);
    this.write = 0;
    this.size = 0;
  }

  _propagate(idx, change) {
    let parent = Math.floor((idx - 1) / 2);
    this.tree[parent] += change;
    if (parent !== 0) {
      this._propagate(parent, change);
    }
  }

  _retrieve(idx, s) {
    const left = 2 * idx + 1;
    const right = left + 1;

    if (left >= this.tree.length) {
      return idx;
    }

    if (s <= this.tree[left]) {
      return this._retrieve(left, s);
    } else {
      return this._retrieve(right, s - this.tree[left]);
    }
  }

  total() {
    return this.tree[0];
  }

  add(priority, data) {
    const idx = this.write + this.capacity - 1;

    this.data[this.write] = data;
    this.update(idx, priority);

    this.write = (this.write + 1) % this.capacity;
    if (this.size < this.capacity) {
        this.size++;
    }
  }

  update(idx, priority) {
    const change = priority - this.tree[idx];
    this.tree[idx] = priority;
    this._propagate(idx, change);
  }

  get(s) {
    const idx = this._retrieve(0, s);
    const dataIdx = idx - this.capacity + 1;
    return {
      idx: idx,
      priority: this.tree[idx],
      data: this.data[dataIdx]
    };
  }
}


// +++ Prioritized Replay Buffer using SumTree +++
class PrioritizedReplayBuffer {
  constructor(capacity, alpha = 0.6) {
    this.tree = new SumTree(capacity);
    this.alpha = alpha;
    this.capacity = capacity;
    this.PER_e = 1e-5; // Epsilon to ensure no priority is zero
    this.maxPriority = 1.0;
  }

  add(experience) {
    // New experiences get maximum priority to ensure they are replayed
    this.tree.add(this.maxPriority, experience);
  }

  sample(batchSize, beta = 0.4) {
    const experiences = [];
    const indices = [];
    const weights = [];
    
    const segment = this.tree.total() / batchSize;
    const priorities = [];

    for (let i = 0; i < batchSize; i++) {
      const a = segment * i;
      const b = segment * (i + 1);
      const s = Math.random() * (b - a) + a;
      
      const { idx, priority, data } = this.tree.get(s);

      if (data) {
        priorities.push(priority);
        experiences.push(data);
        indices.push(idx);
      }
    }

    const samplingProbabilities = priorities.map(p => p / this.tree.total());
    
    const maxWeight = Math.pow(this.tree.size * Math.min(...samplingProbabilities), -beta);

    const sampleWeights = samplingProbabilities.map(p => 
        Math.pow(this.tree.size * p, -beta) / maxWeight
    );

    return {
      experiences: experiences,
      indices: indices,
      weights: tf.tensor1d(sampleWeights)
    };
  }

  updatePriorities(indices, tdErrors) {
    for (let i = 0; i < indices.length; i++) {
      const priority = Math.pow(Math.abs(tdErrors[i]) + this.PER_e, this.alpha);
      this.tree.update(indices[i], priority);
      // Update max priority
      if (priority > this.maxPriority) {
          this.maxPriority = priority;
      }
    }
  }

  get length() {
    return this.tree.size;
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
      const validIndices = validMask
        .map((valid, idx) => valid ? idx : -1)
        .filter(idx => idx !== -1);
      if (validIndices.length === 0) {
        console.warn("No valid actions available!");
        return 0;
      }
      return validIndices[Math.floor(Math.random() * validIndices.length)];
    }
    
    return tf.tidy(() => {
      const stateVector = this.stateToVector(state);
      const qValuesTensor = this.model.predict(stateVector);
      const qValues = qValuesTensor.dataSync();
      
      const maskedQValues = qValues.map((q, idx) => 
        validMask[idx] ? q : -Infinity
      );
      
      return maskedQValues.indexOf(Math.max(...maskedQValues));
    });
  }

  remember(state, action, reward, nextState, done) {
    this.replayBuffer.add({ state, action, reward, nextState, done });
  }

  // 追加: epsilon 減衰を独立化
  decayEpsilon() {
    if (this.epsilon > this.minEpsilon) {
      this.epsilon = Math.max(this.minEpsilon, this.epsilon * this.epsilonDecay);
    }
  }

  async replay(batchSize, beta) {
    if (this.replayBuffer.length < batchSize) {
      return { loss: 0 };
    }

    const { experiences, indices, weights } = this.replayBuffer.sample(batchSize, beta);
    if (experiences.length === 0) {
      weights.dispose();
      return { loss: 0 };
    }
    
    const stateTensors = [];
    const nextStateTensors = [];
    
    for (let exp of experiences) {
      stateTensors.push(this.stateToVector(exp.state));
      nextStateTensors.push(this.stateToVector(exp.nextState));
    }
    
    const states = stateTensors.map(t => {
      const data = t.dataSync();
      t.dispose();
      return data;
    });
    
    const nextStates = nextStateTensors.map(t => {
      const data = t.dataSync();
      t.dispose();
      return data;
    });

    const nextQValues = tf.tidy(() => {
      const nextStatesTensor = tf.tensor2d(nextStates, [nextStates.length, this.model.input.shape[1]]);
      return this.targetModel.predict(nextStatesTensor).arraySync();
    });
    
    const targets = experiences.map((exp, i) => {
      let target = exp.reward;
      if (!exp.done) {
        target = exp.reward + this.gamma * Math.max(...nextQValues[i]);
      }
      return target;
    });

    let loss;
    const statesTensor = tf.tensor2d(states, [states.length, this.model.input.shape[1]]);
    const targetsTensor = tf.tensor1d(targets);
    const actionIndices = experiences.map(exp => exp.action);

    const lossFunction = () => {
      const qValues = this.model.apply(statesTensor);
      const qValuesForActions = qValues.mul(tf.oneHot(tf.tensor1d(actionIndices, 'int32'), this.actions.length)).sum(-1);
      const tdErrorsTensor = tf.sub(targetsTensor, qValuesForActions);
      
      const tdErrors = tdErrorsTensor.dataSync();
      this.replayBuffer.updatePriorities(indices, tdErrors);

      const weightedSquaredError = tf.mul(weights, tf.square(tdErrorsTensor));
      return tf.mean(weightedSquaredError);
    };

    const {value, grads} = this.optimizer.computeGradients(lossFunction);

    if (grads) {
      this.optimizer.applyGradients(grads);
      tf.dispose(grads);
    }

    loss = value.dataSync()[0];
    
    tf.dispose([value, statesTensor, targetsTensor, weights]);
    
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