import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  Button,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
} from 'react-native';
import { createSession, provider } from 'study-provider';
import {
  exercise,
  ProtocolFailure,
  type Message,
  type Session,
} from './protocol';

export default function App({
  studyPath = '',
  reportURL,
}: {
  studyPath?: string;
  reportURL?: string;
}) {
  const [path, setPath] = useState(studyPath);
  const [session, setSession] = useState<Session>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState('Enter a GGUF filesystem path.');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const answerCommits = useRef<{ atMs: number; length: number }[]>([]);

  useLayoutEffect(() => {
    if (answer.length > 0) {
      answerCommits.current.push({ atMs: Date.now(), length: answer.length });
    }
  }, [answer]);

  const perform = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`ERROR: ${message}`);
      console.error('[integration-study]', error);
    } finally {
      setBusy(false);
    }
  }, []);

  async function send() {
    if (!session) throw new Error('Load a model first');
    const request: Message[] = [...messages, { role: 'user', content: input }];
    setAnswer('');
    const result = await session.complete(request, (delta) =>
      setAnswer((text) => text + delta)
    );
    setMessages([...request, { role: 'assistant', content: result.text }]);
    setInput('');
    setStatus(`Completed: ${result.tokens} tokens`);
  }

  const runStudy = useCallback(async () => {
    const results: object[] = [];
    answerCommits.current = [];
    setAnswer('');
    setStatus(`Running ${provider}`);
    try {
      const result = await exercise(createSession, path, (delta) =>
        setAnswer((text) => text + delta)
      );
      const commitsBeforeResolution = answerCommits.current.filter(
        ({ atMs }) =>
          atMs >= result.streaming.startedAtMs &&
          atMs < result.streaming.resolvedAtMs
      );
      const verified = { ...result, ui: { commitsBeforeResolution } };
      if (
        result.streaming.callbacksBeforeResolution === 0 ||
        commitsBeforeResolution.length < 2
      ) {
        results.push({
          provider,
          error: 'No incremental UI streaming',
          result: verified,
        });
        throw new Error(
          'Expected callbacks and multiple UI commits before resolution'
        );
      }
      console.log(
        'INTEGRATION_RESULT ' + JSON.stringify({ provider, result: verified })
      );
      results.push({ provider, result: verified });
      setStatus(`${provider}: PASS`);
    } catch (error) {
      if (results.length === 0) {
        results.push({
          provider,
          error: String(error),
          observations:
            error instanceof ProtocolFailure ? error.observations : undefined,
        });
      }
      console.error(
        'INTEGRATION_RESULT ' +
          JSON.stringify({ provider, error: String(error) })
      );
    }
    if (reportURL) {
      const response = await fetch(reportURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results }),
      });
      if (!response.ok)
        throw new Error(`Result capture failed: ${response.status}`);
    }
    if (results.some((result) => 'error' in result)) {
      throw new Error(
        'One or more providers failed; inspect recorded results.'
      );
    }
    setStatus(`${provider} passed the scripted protocol.`);
  }, [path, reportURL]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (studyPath) perform(runStudy);
  }, [perform, runStudy, studyPath]);

  return (
    <SafeAreaView>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        <Text>Matched local chat integration study</Text>
        <Text selectable>{status}</Text>
        <TextInput
          value={path}
          onChangeText={setPath}
          placeholder="GGUF path"
        />
        <Text>Provider: {provider}</Text>
        <Button
          title="Load"
          disabled={busy || !!session || !path}
          onPress={() =>
            perform(async () => {
              setSession(await createSession(path));
              setStatus('Loaded');
            })
          }
        />
        {messages.map((message, index) => (
          <Text key={index}>
            {message.role}: {message.content}
          </Text>
        ))}
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Message"
        />
        <Button
          title="Send"
          disabled={busy || !session || !input.trim()}
          onPress={() => perform(send)}
        />
        <Text selectable>{answer}</Text>
        <Button
          title="Unload"
          disabled={busy || !session}
          onPress={() =>
            perform(async () => {
              await session!.release();
              setSession(undefined);
              setMessages([]);
              setAnswer('');
              setStatus('Released');
            })
          }
        />
        <Button
          title="Run scripted protocol"
          disabled={busy || !!session || !path}
          onPress={() => perform(runStudy)}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
