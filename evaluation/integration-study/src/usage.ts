import { Thistle, type ThistleMessage } from 'react-native-thistle';

export async function example(
  modelPath: string,
  appendAnswer: (delta: string) => void
) {
  const model = await Thistle.init(modelPath, {
    maxContextSize: 2048,
    maxOutputTokens: 64,
    temperature: 0,
    seed: 42,
    enableThinking: false,
  });
  try {
    const messages: ThistleMessage[] = [
      { role: 'user', content: 'Name a river in Paris.' },
    ];
    const first = await model.chat(messages);
    messages.push(
      { role: 'assistant', content: first.text },
      { role: 'user', content: 'Describe its surroundings.' }
    );
    await model.stream(messages, (delta) => appendAnswer(delta));
  } finally {
    model.unload();
  }
}
