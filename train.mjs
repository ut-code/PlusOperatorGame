import { DQNAgent } from './dqn-agent.mjs';
import { GameWrapper } from './game-wrapper.mjs';
import { buildModel, calculateStateSize } from './model-builder.mjs';
import { Op } from './game-logic.mjs';
import * as tf from '@tensorflow/tfjs';      // この行を追加
import { promises as fs } from 'fs';

function formatBytes(bytes) {
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function logMemory() {
    const mem = process.memoryUsage();
    const numTensors = tf.memory().numTensors;
    return `RAM: ${formatBytes(mem.heapUsed)}/${formatBytes(mem.heapTotal)} | Tensors: ${numTensors}`;
}

const MAX_MOVES_PER_EPISODE = 200;
const EPISODES = 100000;
const BATCH_SIZE = 32;
const SAVE_INTERVAL = 1000;
const LOG_INTERVAL = 100;
const TARGET_UPDATE_INTERVAL = 10;
const REPLAY_BUFFER_CAPACITY = 50000;

const curriculum = [
    { level: 0, maxFieldValue: 5, threshold: 5.0, difficulty: 'easy' },
    { level: 1, maxFieldValue: 10, threshold: 8.0, difficulty: 'easy' },
    { level: 2, maxFieldValue: 20, threshold: 10.0, difficulty: 'normal' },
    { level: 3, maxFieldValue: 50, threshold: 12.0, difficulty: 'normal' },
    { level: 4, maxFieldValue: 100, threshold: 15.0, difficulty: 'hard' },
];

let currentLevel = 0;

async function ensureDirectory(dirPath) {
    try {
        await fs.access(dirPath);
    } catch {
        await fs.mkdir(dirPath, { recursive: true });
    }
}

// file:// ハンドラがあればそれを使い、なければ artifacts を取得して手動で保存する
async function saveModelSmart(model, dir) {
  const url = `file://${dir}`;
  try {
    const handlers = tf.io.getSaveHandlers(url);
    if (handlers && handlers.length > 0) {
      // Node の file:// ハンドラが使える場合
      await model.save(url);
      return;
    }
  } catch (e) {
    // getSaveHandlers が失敗しても fallback へ
  }

  // fallback: artifacts を取得して自前で書き出す
  const artifacts = await model.save(tf.io.withSaveHandler(async (artifacts) => artifacts));
  await fs.mkdir(dir, { recursive: true });

  const modelJson = {
    modelTopology: artifacts.modelTopology || null,
    format: artifacts.format || 'layers-model',
    generatedBy: artifacts.generatedBy || 'custom-save',
    convertedBy: artifacts.convertedBy || null,
    weightsManifest: [
      {
        paths: ['weights.bin'],
        weights: artifacts.weightSpecs || []
      }
    ]
  };

  await fs.writeFile(`${dir}/model.json`, JSON.stringify(modelJson, null, 2), 'utf8');

  if (artifacts.weightData) {
    const buf = Buffer.from(new Uint8Array(artifacts.weightData));
    await fs.writeFile(`${dir}/weights.bin`, buf);
  }
}

async function main() {
    console.log("=" .repeat(60));
    console.log("DQN Plus Operator Training Environment");
    console.log("=" .repeat(60));
    
    await ensureDirectory('./dqn-model');
    await ensureDirectory('./training_logs');
    
    const opList = Op.list;
    const stateSize = calculateStateSize(opList.length);
    
    let env = new GameWrapper(curriculum[currentLevel].maxFieldValue, curriculum[currentLevel].difficulty);
    const numActions = env.actions.length;
    
    console.log(`State size: ${stateSize}`);
    console.log(`Action space size: ${numActions}`);
    console.log(`Operators: ${opList.map(op => op.name).join(', ')}`);
    
    let model, targetModel, agent;
    const modelPath = './dqn-model/model.json';
    
    try {
        await fs.access(modelPath);
        console.log("\nLoading existing model...");
        model = await tf.loadLayersModel(`file://${modelPath}`);
        targetModel = await tf.loadLayersModel(`file://${modelPath}`);
        console.log("Model loaded successfully.");
    } catch (error) {
        console.log("\nNo existing model found, creating a new one.");
        model = buildModel(stateSize, numActions, [256, 256, 128]);
        targetModel = buildModel(stateSize, numActions, [256, 256, 128]);
        targetModel.setWeights(model.getWeights());
    }
    
    console.log("\nModel Summary:");
    model.summary();
    
    agent = new DQNAgent(
        model,
        targetModel,
        REPLAY_BUFFER_CAPACITY,
        env.actions,
        opList,
        0.99,    // gamma
        1.0,     // initial epsilon
        0.01,    // min epsilon
        0.0001   // learning rate
    );
    
    console.log("\n" + "=".repeat(60));
    console.log("Starting Training...");
    console.log("=".repeat(60) + "\n");
    
    const EPSILON_START = 1.0;
    const EPSILON_END = 0.1;
    const BETA_START = 0.4;
    const BETA_END = 1.0;
    const LEVEL_PROGRESS_EPISODES = 35000;

    let episodeRewards = [];
    let recentScores = [];
    let recentClears = [];
    let totalWins = 0;
    let episodesInLevel = 0;
    
    for (let episode = 0; episode < EPISODES; episode++) {
        const { maxFieldValue, difficulty } = curriculum[currentLevel];
        env = new GameWrapper(maxFieldValue, difficulty);
        
        let state = env.reset();
        let episodeReward = 0;
        let done = false;
        let moves = 0;
        
        // Update epsilon and beta based on progress within the current level
        episodesInLevel++;
        const progressInLevel = Math.min(1.0, episodesInLevel / LEVEL_PROGRESS_EPISODES);
        
        agent.epsilon = Math.max(EPSILON_END, EPSILON_START - (EPSILON_START - EPSILON_END) * progressInLevel);
        const beta = BETA_START + (BETA_END - BETA_START) * progressInLevel;

        while (!done && moves < MAX_MOVES_PER_EPISODE) {
            const action = agent.chooseAction(state, env);
            const { nextState, reward, done: isDone, info } = env.step(action);
            
            
            agent.remember(state, action, reward, nextState, isDone);
            
            state = nextState;
            episodeReward += reward;
            done = isDone;
            moves++;
        }
        
        if (done) {
            totalWins++;
            recentClears.push(1);
        } else {
            recentClears.push(0);
        }
        
        if (agent.replayBuffer.length > BATCH_SIZE && episode % 2 === 0) {
            const { loss } = await agent.replay(BATCH_SIZE, beta);
        }
        
        if ((episode + 1) % TARGET_UPDATE_INTERVAL === 0) {
            agent.updateTargetModel();
        }
        
        if ((episode + 1) % 500 === 0) {
            if (global.gc) {
                global.gc();
            }
        }
        
        episodeRewards.push(episodeReward);
        recentScores.push(episodeReward);
        
        if (recentScores.length > 100) {
            recentScores.shift();
        }
        if (recentClears.length > 100) {
            recentClears.shift();
        }
        
        if ((episode + 1) % LOG_INTERVAL === 0) {
            const recentAvgReward = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
            const clearRate = (recentClears.reduce((a, b) => a + b, 0) / recentClears.length) * 100;
            
            const memInfo = logMemory();
            console.log(
                `Ep: ${String(episode + 1).padStart(6)}/${EPISODES} | ` +
                `Lvl: ${currentLevel} | ` +
                `ε: ${agent.epsilon.toFixed(4)} | ` +
                `β: ${beta.toFixed(4)} | ` +
                `Avg(100): ${recentAvgReward.toFixed(2)} | ` +
                `Clear: ${clearRate.toFixed(1)}% | ` +
                `Wins: ${totalWins} | ` +
                `${memInfo}`
            );
            
            if (currentLevel < curriculum.length - 1) {
                if (recentAvgReward > curriculum[currentLevel].threshold && recentScores.length === 100) {
                    currentLevel++;
                    episodesInLevel = 0; // Reset for the new level
                    console.log("\n" + "🚀".repeat(30));
                    console.log(`   LEVEL UP to ${currentLevel}!`);
                    console.log(`   Max Value: ${curriculum[currentLevel].maxFieldValue}`);
                    console.log(`   Difficulty: ${curriculum[currentLevel].difficulty}`);
                    console.log("🚀".repeat(30) + "\n");
                    
                    recentScores = [];
                    recentClears = [];
                }
            }
        }
        
        if ((episode + 1) % SAVE_INTERVAL === 0) {
            console.log(`\n💾 Saving model at episode ${episode + 1}...`);
            await saveModelSmart(model, './dqn-model');
            
            const stats = {
                episode: episode + 1,
                level: currentLevel,
                epsilon: agent.epsilon,
                beta: beta,
                totalWins: totalWins,
                avgReward: recentScores.reduce((a, b) => a + b, 0) / recentScores.length,
                clearRate: (recentClears.reduce((a, b) => a + b, 0) / recentClears.length) * 100
            };
            
            await fs.writeFile(
                `./training_logs/stats_ep${episode + 1}.json`,
                JSON.stringify(stats, null, 2)
            );
            console.log(`✓ Model and stats saved.\n`);
        }
    }
    
    console.log("\n" + "=".repeat(60));
    console.log("Training Complete!");
    console.log("=".repeat(60));
    console.log(`Total Wins: ${totalWins}`);
    console.log(`Final Level: ${currentLevel}`);
    console.log(`Final Epsilon: ${agent.epsilon.toFixed(4)}`);
    
    await saveModelSmart(model, './dqn-model');
    console.log("\n✓ Final model saved to ./dqn-model/");
}

main().catch(error => {
    console.error("Training error:", error);
    process.exit(1);
});
