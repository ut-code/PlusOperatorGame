import * as tf from '@tensorflow/tfjs-node';

export function buildModel(inputSize, outputSize, hiddenLayers = [128, 128]) {
  const model = tf.sequential();
  
  model.add(tf.layers.dense({
    inputShape: [inputSize],
    units: hiddenLayers[0],
    activation: 'relu',
    kernelInitializer: 'heNormal'
  }));
  
  model.add(tf.layers.dropout({ rate: 0.2 }));
  
  for (let i = 1; i < hiddenLayers.length; i++) {
    model.add(tf.layers.dense({
      units: hiddenLayers[i],
      activation: 'relu',
      kernelInitializer: 'heNormal'
    }));
    
    model.add(tf.layers.dropout({ rate: 0.2 }));
  }
  
  model.add(tf.layers.dense({
    units: outputSize,
    activation: 'linear',
    kernelInitializer: 'heNormal'
  }));
  
  return model;
}

export function calculateStateSize(opListLength) {
  return 6 + 4 + (4 * opListLength);
}
