// weak-cpu-agent.mjs
import { GameWrapper } from './game-wrapper.mjs';

export class WeakCpuAgent {
    constructor(gameWrapper) {
        this.gameWrapper = gameWrapper;
    }

    makeMove() {
        const state = this.gameWrapper.getState();
        const actions = this.gameWrapper.actions; // Get the predefined actions from GameWrapper

        // Filter for valid actions
        let validActions = [];
        for (let i = 0; i < actions.length; i++) {
            const action = actions[i];
            // Check if the field, op, and num cards are valid (not null or invalid)
            // This is a simplified check. A more robust check would involve Op.isFValid and Op.isPValid
            if (state.field.valid[action.field] && state.op.valid[action.op] && state.num.valid[action.num]) {
                validActions.push(i);
            }
        }

        if (validActions.length === 0) {
            console.warn("No valid actions available for Weak CPU.");
            return false; // No move can be made
        }

        // Randomly select one of the valid actions
        const randomActionIndex = validActions[Math.floor(Math.random() * validActions.length)];
        
        // Perform the action using the game wrapper's step method
        const { reward, done, info } = this.gameWrapper.step(randomActionIndex);
        
        return { reward, done, info };
    }
}
