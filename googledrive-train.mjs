import { DQNAgent } from './dqn-agent.mjs';
import { GameWrapper } from './game-wrapper.mjs';
import { buildModel, calculateStateSize } from './model-builder.mjs';
import * as tf from '@tensorflow/tfjs-node';
import { Op } from './game-logic.mjs';
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
  
  // === 1. 標準の save ハンドラを試す ===
  try {
    const handlers = tf.io.getSaveHandlers(url);
    if (handlers && handlers.length > 0) {
      // Node の file:// ハンドラが使える場合
      await model.save(url);
      return true; // 成功
    }
  } catch (e) {
    console.warn(`\n[Save Warning] Standard model.save(url) failed: ${e.message}. Attempting fallback...`);
  }

  // === 2. フォールバック (手動書き出し) ===
  try {
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
    return true; // 成功
  
  } catch (fallbackError) {
    console.error(`\n[Save Error] Fallback save failed: ${fallbackError.message}`);
    return false; // 失敗
  }
}

// [修正] L97-L103 の重複コードを削除しました

function getDifficultyConfig(levelName) {
    const ops = {
        'easy': ['add', 'sub', 'mul', 'div'],
        'normal': ['add', 'sub', 'mul', 'div', 'rem', 'root', 'd', 'gcd'],
        'hard': ['add', 'sub', 'mul', 'div', 'rem', 'and', 'or', 'xor', 'pop']
    };
    const numRanges = {
        'easy': [1, 9],   // game-logic.mjs  (L101) の numRange
        'normal': [1, 15],
        'hard': [1, 20]
    };
    
    const selectedLevel = levelName || 'easy';
    
    return {
        levelName: selectedLevel,
        ops: ops[selectedLevel],      // game-logic.mjs  (L99)
        numRange: numRanges[selectedLevel] // game-logic.mjs  (L101)
    };
}

async function main() {
    console.log("=" .repeat(60));
    console.log("DQN Plus Operator Training Environment");
    console.log("=" .repeat(60));
    
    // [変更] Google Drive マウントパスを定義
    const MODEL_SAVE_PATH = '/content/drive/MyDrive/plusoperatorgame/dqn-model';
    const LOG_SAVE_PATH = '/content/drive/MyDrive/plusoperatorgame/training_logs';

    await ensureDirectory(MODEL_SAVE_PATH); // [変更]
    await ensureDirectory(LOG_SAVE_PATH); // [変更]
    
    const opList = Op.list;
    const stateSize = calculateStateSize(opList.length);
    const currentConfig = curriculum[currentLevel];
    const difficultyConfig = getDifficultyConfig(currentConfig.difficulty);
    let env = new GameWrapper(
            difficultyConfig, 
            'solo', // rule は 'solo' と仮定
            currentConfig.maxFieldValue, 
            MAX_MOVES_PER_EPISODE
        );
    const numActions = env.getActionSpaceSize();
    
    console.log(`State size: ${stateSize}`);
    console.log(`Action space size: ${numActions}`);
    console.log(`Operators: ${opList.map(op => op.name).join(', ')}`);
    
    let model, targetModel, agent;
    // [変更] Google Drive 上のパスを使用
    const modelPath = `${MODEL_SAVE_PATH}/model.json`;
    
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
    
    const EPSILON_START = 0.9;
    const EPSILON_END = 0.1;
    const BETA_START = 0.4;
    const BETA_END = 1.0;
    // [修正提案] 100000 -> 35000 に戻し、カリキュラムが進むようにします
    const LEVEL_PROGRESS_EPISODES = 35000; 

    let episodeRewards = [];
    let recentScores = [];
    let recentClears = [];
    let totalWins = 0;
    let episodesInLevel = 0;
    
    for (let episode = 0; episode < EPISODES; episode++) {
        const { maxFieldValue, difficulty } = curriculum[currentLevel];
        
        const newDifficultyConfig = getDifficultyConfig(difficulty);
        env = new GameWrapper(
            newDifficultyConfig,
            'solo',
            maxFieldValue,
            MAX_MOVES_PER_EPISODE
        );
        let state = env.reset();
        let episodeReward = 0;
        let done = false;
        let moves = 0;
        let lastInfo = {};
        
        // Update epsilon and beta based on progress within the current level
        episodesInLevel++;
        const progressInLevel = Math.min(1.0, episodesInLevel / LEVEL_PROGRESS_EPISODES);
        
        agent.epsilon = Math.max(EPSILON_END, EPSILON_START - (EPSILON_START - EPSILON_END) * progressInLevel);
        const beta = BETA_START + (BETA_END - BETA_START) * progressInLevel;

        while (!done && moves < MAX_MOVES_PER_EPISODE) {
            const action = agent.chooseAction(state, env);
            const { state: nextState, reward, done: isDone, info } = env.step(action);
            
            
            agent.remember(state, action, reward, nextState, isDone);
            lastInfo = info;
            state = nextState;
            episodeReward += reward;
            done = isDone;
            moves++;
        }
        
        if (done && lastInfo.reason === 'Cleared') {
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
            // [修正] ゼロ除算を防止
            const recentAvgReward = recentScores.length > 0 ? recentScores.reduce((a, b) => a + b, 0) / recentScores.length : 0;
            const clearRate = recentClears.length > 0 ? (recentClears.reduce((a, b) => a + b, 0) / recentClears.length) * 100 : 0;
            
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
        
        // [修正] 保存ブロックを try...catch で囲む
        if ((episode + 1) % SAVE_INTERVAL === 0) {
            try {
                console.log(`\n💾 Saving model at episode ${episode + 1}...`);
                // [変更] Google Drive パスを使用
                const saveSuccess = await saveModelSmart(model, MODEL_SAVE_PATH);
            
                const stats = {
                    episode: episode + 1,
                    level: currentLevel,
                    epsilon: agent.epsilon,
                    beta: beta,
                    totalWins: totalWins,
                    avgReward: recentScores.length > 0 ? recentScores.reduce((a, b) => a + b, 0) / recentScores.length : 0,
                    clearRate: recentClears.length > 0 ? (recentClears.reduce((a, b) => a + b, 0) / recentClears.length) * 100 : 0
                };
            
                await fs.writeFile(
                    // [変更] Google Drive パスを使用
                    `${LOG_SAVE_PATH}/stats_ep${episode + 1}.json`,
                    JSON.stringify(stats, null, 2)
                );

                if (saveSuccess) {
                    console.log(`✓ Model and stats saved.\n`);
                } else {
                    console.log(`✓ Stats saved, but model save failed (see error above).\n`);
                }
          
            } catch (saveError) {
                console.error(`\n[Save Error] Failed to write files at episode ${episode + 1}.`);
                console.error(`Error details: ${saveError.message}`);
                console.log("Continuing training without saving...\n");
            }
            
          
        }
    }
    
    console.log("\n" + "=".repeat(60));
    console.log("Training Complete!");
    console.log("=".repeat(60));
    console.log(`Total Wins: ${totalWins}`);
    console.log(`Final Level: ${currentLevel}`);
    console.log(`Final Epsilon: ${agent.epsilon.toFixed(4)}`);
    
    // [変更] 最終保存も Google Drive パスを使用
    await saveModelSmart(model, MODEL_SAVE_PATH);
    console.log(`\n✓ Final model saved to ${MODEL_SAVE_PATH}/`);
}

main().catch(error => {
    console.error("Training error:", error);
    process.exit(1);
});