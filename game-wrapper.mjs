import { Game, Op } from './game-logic.mjs';

export class GameWrapper {
  constructor(maxFieldValue = 20, difficulty = 'easy') {
    this.maxFieldValue = maxFieldValue;
    
    const difficultySettings = {
      'easy': {
        ops: ['add', 'sub', 'mul', 'div'],
        numRange: [1, 5],
        levelName: 'easy'
      },
      'normal': {
        ops: ['add', 'sub', 'mul', 'div', 'rem', 'root', 'd', 'gcd'],
        numRange: [1, 10],
        levelName: 'normal'
      },
      'hard': {
        ops: ['add', 'sub', 'mul', 'div', 'rem', 'and', 'or', 'xor', 'pop'],
        numRange: [1, 10],
        levelName: 'hard'
      }
    };
    
    this.difficulty = difficultySettings[difficulty] || difficultySettings['easy'];
    this.game = new Game(this.difficulty, null, maxFieldValue);
    this.allOps = Op.list;
    
    this.actions = this.generateActionSpace();
    this.totalMoves = 0;
    this.validMoves = 0;
  }
  
  generateActionSpace() {
    const actions = [];
    for (let fieldIdx = 0; fieldIdx < 6; fieldIdx++) {
      for (let opIdx = 0; opIdx < 4; opIdx++) {
        for (let numIdx = 0; numIdx < 4; numIdx++) {
          actions.push({
            field: fieldIdx,
            op: opIdx,
            num: numIdx
          });
        }
      }
    }
    return actions;
  }
  
  reset() {
    this.game = new Game(this.difficulty, null, this.maxFieldValue);
    this.totalMoves = 0;
    this.validMoves = 0;
    return this.getObservation();
  }
  
  createStateSnapshot() {
    const state = this.game.state;
    return {
      field: {
        values: [...state.field.values],
        chosen: state.field.chosen
      },
      num: {
        values: [...state.num.values],
        chosen: state.num.chosen
      },
      op: {
        values: state.op.values.map(op => ({
          name: op.name,
          r_param: op.r_param,
          isFValid: op.isFValid,
          isPValid: op.isPValid,
          calc: op.calc
        })),
        chosen: state.op.chosen
      }
    };
  }
  
  getObservation() {
    return this.createStateSnapshot();
  }
  
  step(actionIdx) {
    const action = this.actions[actionIdx];
    
    this.game.click('field', action.field);
    this.game.click('op', action.op);
    this.game.click('num', action.num);
    
    const previousFieldValues = this.game.state.field.values.slice(0, 6);
    
    const moveSuccessful = this.game.apply();
    this.totalMoves++;
    
    if (moveSuccessful) {
      this.validMoves++;
    }
    
    const nextState = this.getObservation();
    const currentFieldValues = nextState.field.values.slice(0, 6);
    
    let reward = 0;
    const done = this.game.cleared;
    
    if (done) {
      reward = 1;
    } else if (!moveSuccessful) {
      reward = -1;
    } else {
      const prevSum = previousFieldValues.reduce((a, b) => a + b, 0);
      const currSum = currentFieldValues.reduce((a, b) => a + b, 0);
      const improvement = prevSum - currSum;
      reward = improvement / 50;
      
      const prevDistance = previousFieldValues.reduce((sum, v) => sum + Math.abs(v - 1), 0);
      const currDistance = currentFieldValues.reduce((sum, v) => sum + Math.abs(v - 1), 0);
      if (currDistance < prevDistance) {
        reward += 0.01;
      }
    }
    
    return {
      nextState,
      reward,
      done,
      info: {
        totalMoves: this.totalMoves,
        validMoves: this.validMoves,
        moveSuccessful
      }
    };
  }
  
  getValidActionMask() {
    const mask = new Array(this.actions.length).fill(false);
    
    for (let i = 0; i < this.actions.length; i++) {
      const action = this.actions[i];
      const field = this.game.state.field.values[action.field];
      const op = this.game.state.op.values[action.op];
      const num = this.game.state.num.values[action.num];
      
      if (!op.r_param) {
        mask[i] = op.isFValid(field);
      } else {
        mask[i] = op.isFValid(field) && op.isPValid(num);
      }
    }
    
    return mask;
  }
}
