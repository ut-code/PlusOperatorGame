import * as tf from '@tensorflow/tfjs';
import { Game, Op } from './game-logic.mjs';
import { DQNAgent } from './dqn-agent.mjs';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

const EPISODES = 8000;
const LEVEL = 'easy';
const MAX_MOVES_PER_EPISODE = 100;
const BATCH_SIZE = 32;
const UPDATE_TARGET_EVERY = 5; // episodes
const REPLAY_BUFFER_CAPACITY = 10000;

// Beta annealing for Prioritized Experience Replay
const BETA_START = 0.4;
const BETA_END = 1.0;
const BETA_ANNEAL_FRAC = 0.8; // Fraction of total episodes to anneal over

// Curriculum Learning Settings
const curriculum = [
    // threshold: The average reward over the last REWARD_BUFFER_SIZE episodes to level up.
    // This value may need tuning.
    { max: 5, threshold: 1500 },
    { max: 10, threshold: 3000 },
    { max: 15, threshold: 4500 },
    { max: 20, threshold: EPISODES }
];
let currentLevel = 0;
const REWARD_BUFFER_SIZE = 100;
const episodeRewards = [];

// 1. Action Space


const FIELD_COUNT = 6, OP_COUNT = 4, NUM_COUNT = 4;
const actions = [];
for (let i = 0; i < FIELD_COUNT; i++) {
    for (let j = 0; j < OP_COUNT; j++) {
        for (let k = 0; k < NUM_COUNT; k++) {
            actions.push({ field: i, op: j, num: k });
        }
    }
}

// 2. State and Action Sizes
const opList = Op.list;
const stateSize = 6 + 4 + (4 * opList.length);
const actionSize = actions.length;

// 3. DQN Model
function createDQNModel(inputShape, outputShape) {
    const model = tf.sequential();
    model.add(tf.layers.dense({ inputShape: [inputShape], units: 128, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 128, activation: 'relu' }));
    model.add(tf.layers.dense({ units: outputShape, activation: 'linear' }));
    model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });
    return model;
}

// 4. Initialization
const model = createDQNModel(stateSize, actionSize);
const targetModel = createDQNModel(stateSize, actionSize);
targetModel.setWeights(model.getWeights());

const agent = new DQNAgent(model, targetModel, REPLAY_BUFFER_CAPACITY, actions, opList, 0.95, 1.0, 0.01, 0.9998);

// 5. Reward Function
function calculateReward(game, moveSuccess, oldState) {
    if (!moveSuccess) return -10;
    if (game.cleared) return 1000;
    
    // 各フィールドが1にどれだけ近いかを評価（絶対値距離）
    const oldDistance = oldState.field.values.reduce((sum, v) => sum + Math.abs(v - 1), 0);
    const newDistance = game.state.field.values.reduce((sum, v) => sum + Math.abs(v - 1), 0);
    
    const improvement = oldDistance - newDistance;
    
    var reward = improvement*2 - 0.1;
    if (reward < -50) reward = -50;
    if (reward > 50) reward = 50;
    // 改善度に応じた報酬、手数ペナルティを軽減
    return reward;
}

// 6. Training Loop
async function train() {
    console.log('DQN Training Started...');
    let totalMoves = 0;

    // Define difficulty settings that were missing
    const difficulties = {
        'easy': {
            levelName: 'easy',
            ops: ['add', 'sub', 'mul', 'div'],
            numRange: [1, 9]
        },
        'normal': {
            levelName: 'normal',
            ops: ['add', 'sub', 'mul', 'div', 'rem', 'root', 'd', 'gcd'],
            numRange: [1, 20]
        },
        'hard': {
            levelName: 'hard',
            ops: ['add', 'sub', 'mul', 'div', 'rem', 'and', 'or', 'xor', 'pop'],
            numRange: [1, 50]
        }
    };
    const difficulty = difficulties[LEVEL];
    if (!difficulty) {
        console.error(`Invalid LEVEL: ${LEVEL}`);
        return;
    }


    for (let i = 0; i < EPISODES; i++) {
        const maxFieldValue = curriculum[currentLevel].max;
        let game = new Game(difficulty, 'solo', maxFieldValue);
        let state = game.state;
        let moves = 0;
        let episodeReward = 0;
        
        // Calculate current beta
        const beta = Math.min(BETA_END, BETA_START + (BETA_END - BETA_START) * (i / (EPISODES * BETA_ANNEAL_FRAC)));

        while (!game.cleared && moves < MAX_MOVES_PER_EPISODE) {
            const oldState = {
                field: { values: [...state.field.values] },
                num: { values: [...state.num.values] },
                op: { values: [...state.op.values] }
            };
            const actionIndex = agent.chooseAction(state, game);
            const action = actions[actionIndex];
            


            game.click('field', action.field);
            game.click('op', action.op);
            game.click('num', action.num);
            const moveSuccess = game.apply();

            const reward = calculateReward(game, moveSuccess, oldState);
            const nextState = game.state;
            const done = game.cleared;

            agent.remember(state, actionIndex, reward, nextState, done);

            if (agent.replayBuffer.length > BATCH_SIZE) {
                await agent.replay(BATCH_SIZE, beta);
            }

            state = nextState;
            episodeReward += reward;
            moves++;
            totalMoves++;

            if (done) {
                break;
            }
        }

        episodeRewards.push(episodeReward);
        if (episodeRewards.length > REWARD_BUFFER_SIZE) {
            episodeRewards.shift(); // Keep the buffer size fixed
        }

        if ((i + 1) % UPDATE_TARGET_EVERY === 0) {
            agent.updateTargetModel();
            console.log(`Episode ${i + 1}/${EPISODES} | Target model updated.`);
        }
        
        console.log(`Episode ${i + 1}/${EPISODES} | Level: ${currentLevel} (max: ${curriculum[currentLevel].max}) | Moves: ${moves} | Reward: ${episodeReward.toFixed(2)} | Epsilon: ${agent.epsilon.toFixed(4)} | Beta: ${beta.toFixed(4)}`);

        // Decay epsilon at the end of the episode
        agent.decayEpsilon();

        // Curriculum level up check
        if (currentLevel < curriculum.length - 1 && episodeRewards.length === REWARD_BUFFER_SIZE) {
            const avgReward = episodeRewards.reduce((a, b) => a + b, 0) / REWARD_BUFFER_SIZE;
            if (avgReward > curriculum[currentLevel].threshold) {
                currentLevel++;
                console.log(`\nLEVEL UP! New level: ${currentLevel}, Max field value: ${curriculum[currentLevel].max}. Average reward was ${avgReward.toFixed(2)}\n`);
                episodeRewards.length = 0; // Reset rewards for the new level
            }
        }
    }

    const modelDir = './dqn-model';
    if (!existsSync(modelDir)) {
        mkdirSync(modelDir, { recursive: true });
        console.log(`Created directory: ${modelDir}`);
    } else {
        console.log(`Directory already exists: ${modelDir}`);
    }
    
    console.log('Training finished.');
    await model.save('file://./dqn-model');
    console.log('Model saved to ./dqn-model');
}

train();