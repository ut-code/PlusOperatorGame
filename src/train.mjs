import { DQNAgent } from './dqn-agent.mjs';
import { GameWrapper } from './game-wrapper.mjs';
import { buildModel, calculateStateSize } from './model-builder.mjs';
import { Op } from './game-logic.mjs';
import * as tf from '@tensorflow/tfjs-node';
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
        0.99,
        1.0,
        0.01,
        0.9995,
        0.0001
    );
    
    console.log("\n" + "=".repeat(60));
    console.log("Starting Training...");
    console.log("=".repeat(60) + "\n");
    
    let episodeRewards = [];
    let recentScores = [];
    let recentClears = [];
    let totalWins = 0;
    let beta = 0.4;
    const betaIncrement = (1.0 - 0.4) / EPISODES;
    
    for (let episode = 0; episode < EPISODES; episode++) {
        const { maxFieldValue, difficulty } = curriculum[currentLevel];
        env = new GameWrapper(maxFieldValue, difficulty);
        
        let state = env.reset();
        let episodeReward = 0;
        let done = false;
        let moves = 0;
        
        while (!done && moves < MAX_MOVES_PER_EPISODE) {
            const action = agent.chooseAction(state, env);
            const { nextState, reward, done: isDone, info } = env.step(action);
            
            const clippedReward = Math.max(-1, Math.min(1, reward));
            
            agent.remember(state, action, clippedReward, nextState, isDone);
            
            state = nextState;
            episodeReward += clippedReward;
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
        
        agent.decayEpsilon();
        
        if ((episode + 1) % TARGET_UPDATE_INTERVAL === 0) {
            agent.updateTargetModel();
        }
        
        if ((episode + 1) % 500 === 0) {
            if (global.gc) {
                global.gc();
            }
        }
        
        beta = Math.min(1.0, beta + betaIncrement);
        
        episodeRewards.push(episodeReward);
        recentScores.push(episodeReward);
        
        if (recentScores.length > 100) {
            recentScores.shift();
        }
        if (recentClears.length > 100) {
            recentClears.shift();
        }
        
        if ((episode + 1) % LOG_INTERVAL === 0) {
            const avgReward = episodeRewards.slice(-LOG_INTERVAL).reduce((a, b) => a + b, 0) / LOG_INTERVAL;
            const recentAvgReward = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
            const clearRate = (recentClears.reduce((a, b) => a + b, 0) / recentClears.length) * 100;
            const bufferSize = agent.replayBuffer.length;
            
            const memInfo = logMemory();
            console.log(
                `Ep: ${String(episode + 1).padStart(6)}/${EPISODES} | ` +
                `Lvl: ${currentLevel} | ` +
                `ε: ${agent.epsilon.toFixed(4)} | ` +
                `Avg(${LOG_INTERVAL}): ${avgReward.toFixed(2)} | ` +
                `Avg(100): ${recentAvgReward.toFixed(2)} | ` +
                `Clear: ${clearRate.toFixed(1)}% | ` +
                `Wins: ${totalWins} | ` +
                `${memInfo}`
            );
            
            if (currentLevel < curriculum.length - 1) {
                if (recentAvgReward > curriculum[currentLevel].threshold && recentScores.length === 100) {
                    currentLevel++;
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
            await model.save(`file://./dqn-model`);
            
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
    
    await model.save(`file://./dqn-model`);
    console.log("\n✓ Final model saved to ./dqn-model/");
}

main().catch(error => {
    console.error("Training error:", error);
    process.exit(1);
});
