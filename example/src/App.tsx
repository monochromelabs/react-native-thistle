import { useEffect, useRef, useState } from 'react';
import type { ElementRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Keyboard,
  Pressable,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Clipboard from '@react-native-clipboard/clipboard';
import Markdown, { type RenderRules } from 'react-native-markdown-display';
import { MathView } from '@dawsonxiong/react-native-latex-renderer/lib/module/MathView';
import { Thistle, type ThistleModel } from 'react-native-thistle';

const modelAsset = 'Qwen3VL-2B-Instruct-Q4_K_M.gguf';
const logoAsset = require('../assets/logo.png');
const fontFamily = Platform.OS === 'android' ? 'EBGaramond' : 'EB Garamond';

type Message = { id: string; role: 'user' | 'assistant'; text: string };
type ModelStatus = 'loading' | 'ready' | 'thinking' | 'error';
type ModelState = { status: ModelStatus; error: string | null };

type ContentSegment =
  | { type: 'markdown'; value: string }
  | { type: 'math'; displayMode: boolean; value: string };

const selectableMarkdownRules: Pick<RenderRules, 'text' | 'textgroup'> = {
  text: (node, _children, _parent, styles, inheritedStyles = {}) => (
    <Text
      key={node.key}
      selectable
      style={[inheritedStyles, styles.text, { fontFamily, textAlign: 'left' }]}
    >
      {node.content}
    </Text>
  ),
  textgroup: (node, children, _parent, styles) => (
    <Text key={node.key} selectable style={[styles.textgroup, { fontFamily }]}>
      {children}
    </Text>
  ),
};

function splitMath(text: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const mathPattern = /(\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\$[^$\n]+\$)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(mathPattern)) {
    const value = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: 'markdown', value: text.slice(lastIndex, index) });
    }

    const displayMode = value.startsWith('$$');
    const expression = displayMode
      ? value.slice(2, -2)
      : value.startsWith('\\(')
        ? value.slice(2, -2)
        : value.slice(1, -1);
    segments.push({ type: 'math', displayMode, value: expression });
    lastIndex = index + value.length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'markdown', value: text.slice(lastIndex) });
  }

  return segments;
}

function FormattedAssistantText({ text }: { text: string }) {
  return (
    <View style={styles.formattedAssistantText}>
      {splitMath(text).map((segment, index) =>
        segment.type === 'math' ? (
          <MathView
            key={`${segment.type}-${index}`}
            color="#123456"
            fontSize={16}
            math={`${segment.displayMode ? '$$' : '$'}${segment.value}${
              segment.displayMode ? '$$' : '$'
            }`}
            style={segment.displayMode ? styles.displayMath : styles.math}
          />
        ) : (
          <Markdown
            key={`${segment.type}-${index}`}
            rules={selectableMarkdownRules}
            style={markdownStyles}
          >
            {segment.value}
          </Markdown>
        )
      )}
    </View>
  );
}

function TypedAssistantMessage({ text }: { text: string }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [visibleText, setVisibleText] = useState('');

  useEffect(() => {
    let characterIndex = 0;
    setVisibleText('');
    opacity.setValue(0);
    Animated.timing(opacity, {
      duration: 180,
      toValue: 1,
      useNativeDriver: true,
    }).start();

    const typingInterval = setInterval(() => {
      characterIndex = Math.min(characterIndex + 2, text.length);
      setVisibleText(text.slice(0, characterIndex));
      if (characterIndex === text.length) {
        clearInterval(typingInterval);
      }
    }, 24);

    return () => clearInterval(typingInterval);
  }, [opacity, text]);

  return (
    <Animated.View style={{ opacity }}>
      <FormattedAssistantText text={visibleText} />
    </Animated.View>
  );
}

export default function App() {
  const model = useRef<ThistleModel | null>(null);
  const messagesList = useRef<FlatList<Message>>(null);
  const inputRef = useRef<ElementRef<typeof TextInput>>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [thinkingText, setThinkingText] = useState('Thinking');
  const [thinkingMessageId, setThinkingMessageId] = useState<string | null>(
    null
  );
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const isSendingRef = useRef(false);
  const [state, setState] = useState<ModelState>({
    status: 'loading',
    error: null,
  });

  function scrollToBottom(animated = false) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        messagesList.current?.scrollToEnd({ animated });
        setTimeout(() => {
          messagesList.current?.scrollToEnd({ animated: false });
        }, 50);
      });
    });
  }

  useEffect(() => {
    if (state.status !== 'thinking') return;

    let dots = 0;
    const thinkingInterval = setInterval(() => {
      dots = (dots + 1) % 4;
      setThinkingText(`Thinking${'.'.repeat(dots)}`);
    }, 300);

    return () => clearInterval(thinkingInterval);
  }, [state.status]);

  useEffect(() => {
    let mounted = true;
    Thistle.init(modelAsset, {
      scaffolding: 'xylem',
      maxContextSize: 2048,
      maxOutputTokens: 300,
    })
      .then((loadedModel) => {
        if (mounted) {
          model.current = loadedModel;
          setState({ status: 'ready', error: null });
        } else {
          loadedModel.unload();
        }
      })
      .catch((caughtError: unknown) => {
        if (mounted) {
          setState({
            status: 'error',
            error:
              caughtError instanceof Error
                ? caughtError.message
                : String(caughtError),
          });
        }
      });

    return () => {
      mounted = false;
      model.current?.unload();
      model.current = null;
    };
  }, []);

  useEffect(() => {
    const keyboardSubscription = Keyboard.addListener(
      'keyboardWillShow',
      () => {
        scrollToBottom(true);
      }
    );
    const keyboardHiddenSubscription = Keyboard.addListener(
      'keyboardDidHide',
      () => {
        setTimeout(() => {
          scrollToBottom();
        }, 50);
      }
    );

    return () => {
      keyboardSubscription.remove();
      keyboardHiddenSubscription.remove();
    };
  }, []);

  async function sendMessage() {
    const prompt = input.trim();
    if (!prompt || !model.current || state.status !== 'ready') return;

    isSendingRef.current = true;
    inputRef.current?.focus();
    setInput('');
    setState({ status: 'thinking', error: null });
    setThinkingText('Thinking');
    const thinkingId = `${Date.now()}-thinking`;
    setThinkingMessageId(thinkingId);
    setMessages((current) => [
      ...current,
      { id: `${Date.now()}-user`, role: 'user', text: prompt },
      { id: thinkingId, role: 'assistant', text: 'Thinking' },
    ]);
    scrollToBottom();
    try {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      const response = await model.current.prompt(prompt);
      setMessages((current) => [
        ...current.map((message) =>
          message.id === thinkingId ? { ...message, text: response } : message
        ),
      ]);
      setThinkingMessageId(null);
      isSendingRef.current = false;
      setState({ status: 'ready', error: null });
    } catch (caughtError: unknown) {
      setState({
        status: 'error',
        error:
          caughtError instanceof Error
            ? caughtError.message
            : String(caughtError),
      });
      isSendingRef.current = false;
    }
  }

  async function copyMessage(messageId: string, text: string) {
    await Clipboard.setString(text);
    setCopiedMessageId(messageId);
    setTimeout(() => setCopiedMessageId(null), 1500);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior="padding"
        contentContainerStyle={styles.keyboardContent}
        style={styles.container}
      >
        <LinearGradient
          colors={['#004225', '#056038']}
          end={{ x: 0.5, y: 1 }}
          start={{ x: 0.5, y: 0 }}
          style={[
            styles.header,
            { paddingTop: Platform.OS === 'ios' ? 0 : 40 },
          ]}
        >
          <View style={styles.headerContent}>
            <View style={styles.brandRow}>
              <Image source={logoAsset} style={styles.logo} />
              <View>
                <Text style={styles.title}>Thistle Lite</Text>
                <Text style={styles.subtitle}>
                  A proof of concept demo for react-native-thistle.
                </Text>
              </View>
            </View>
          </View>
        </LinearGradient>
        <FlatList
          contentContainerStyle={[
            styles.messages,
            messages.length === 0 && styles.emptyMessages,
          ]}
          data={messages}
          keyExtractor={(message) => message.id}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollToBottom()}
          onLayout={() => scrollToBottom()}
          ref={messagesList}
          renderItem={({ item }) => (
            <View
              style={[
                styles.message,
                item.role === 'user'
                  ? styles.userMessage
                  : styles.assistantMessage,
              ]}
            >
              {item.id === thinkingMessageId ? (
                <Text style={[styles.messageText, styles.thinkingText]}>
                  {thinkingText}
                </Text>
              ) : item.role === 'assistant' ? (
                <>
                  <TypedAssistantMessage text={item.text} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Copy response"
                    onPress={() => void copyMessage(item.id, item.text)}
                    style={styles.copyButton}
                  >
                    <Text style={styles.copyButtonText}>
                      {copiedMessageId === item.id ? 'Copied!' : 'Copy'}
                    </Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <View style={styles.userBubble}>
                    <Text style={[styles.messageText, styles.userMessageText]}>
                      {item.text}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Copy message"
                    onPress={() => void copyMessage(item.id, item.text)}
                    style={[styles.copyButton, styles.userCopyButton]}
                  >
                    <Text
                      style={[styles.copyButtonText, styles.userCopyButtonText]}
                    >
                      {copiedMessageId === item.id ? 'Copied!' : 'Copy'}
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          )}
          ListEmptyComponent={
            state.error ? (
              <Text style={styles.error}>{state.error}</Text>
            ) : (
              <Text style={styles.empty}>Ask away!</Text>
            )
          }
        />
        <LinearGradient
          colors={['#056038', '#004225']}
          end={{ x: 0.5, y: 1 }}
          start={{ x: 0.5, y: 0 }}
          style={[
            styles.composer,
            { paddingBottom: Platform.OS === 'ios' ? 0 : 20 },
          ]}
        >
          <View style={styles.composerContent}>
            <TextInput
              ref={inputRef}
              editable={state.status === 'ready' || state.status === 'thinking'}
              blurOnSubmit={false}
              onChangeText={setInput}
              onBlur={() => {
                if (isSendingRef.current || state.status === 'thinking') {
                  inputRef.current?.focus();
                }
              }}
              multiline
              numberOfLines={3}
              placeholder="Message the model"
              placeholderTextColor="#718096"
              submitBehavior="newline"
              scrollEnabled
              style={styles.input}
              value={input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                state.status === 'thinking'
                  ? 'Generating response'
                  : 'Send message'
              }
              disabled={state.status !== 'ready' || !input.trim()}
              onPressIn={() => {
                isSendingRef.current = true;
                inputRef.current?.focus();
              }}
              onPress={sendMessage}
              style={({ pressed }) => [
                styles.send,
                pressed && styles.sendPressed,
                (state.status !== 'ready' || !input.trim()) &&
                  styles.sendDisabled,
              ]}
            >
              {state.status === 'thinking' ? (
                <ActivityIndicator color="#E8AF1E" size="small" />
              ) : (
                <Text style={styles.sendText}>↑</Text>
              )}
            </Pressable>
          </View>
        </LinearGradient>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#F8F9FF',
    flex: 1,
  },
  container: {
    backgroundColor: '#F8F9FF',
    flex: 1,
  },
  keyboardContent: { flex: 1 },
  header: {
    borderBottomColor: '#CCCCCC',
    borderBottomWidth: 0.25,
    marginTop: -60,
  },
  headerContent: { paddingHorizontal: 10, paddingTop: 72, paddingBottom: 12 },
  brandRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  logo: { borderRadius: 14, height: 54, width: 54 },
  title: { color: '#F8F9FF', fontFamily, fontSize: 30, fontWeight: 400 },
  subtitle: {
    color: '#F8F9FF',
    fontFamily,
    fontSize: 12,
    marginTop: 1,
    opacity: 0.8,
  },
  messages: { flexGrow: 1, gap: 12, paddingVertical: 10 },
  emptyMessages: { alignItems: 'center', justifyContent: 'center' },
  empty: { color: '#666666', fontFamily, textAlign: 'center' },
  error: {
    color: '#9B1C1C',
    fontFamily,
    marginHorizontal: 15,
    textAlign: 'center',
  },
  message: { margin: 0, paddingVertical: 10 },
  userMessage: {
    alignSelf: 'flex-end',
    marginRight: 10,
    marginTop: 30,
    maxWidth: '90%',
  },
  userBubble: {
    backgroundColor: '#05481E',
    borderRadius: 18,
    overflow: 'hidden',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  assistantMessage: {
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
    marginRight: 0,
    paddingHorizontal: 10,
    width: '100%',
  },
  messageText: {
    color: '#123456',
    fontFamily,
    flexShrink: 1,
    fontSize: 16,
    lineHeight: 23,
    margin: 0,
  },
  formattedAssistantText: {
    alignItems: 'center',
    width: '100%',
  },
  math: { alignSelf: 'center', marginVertical: 2 },
  displayMath: { marginVertical: 2, width: '100%' },
  copyButton: {
    alignSelf: 'flex-start',
  },
  userCopyButton: { alignSelf: 'flex-end', marginTop: 8 },
  copyButtonText: {
    color: '#718096',
    fontFamily,
    fontSize: 12,
    fontWeight: 400,
  },
  userCopyButtonText: { color: '#718096', marginRight: 2 },
  thinkingText: { opacity: 0.5 },
  userMessageText: { color: '#F8F9FF' },
  composer: {
    borderTopColor: '#CCCCCC',
    borderTopWidth: 0.25,
    marginBottom: -60,
  },
  composerContent: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 72,
  },
  input: {
    backgroundColor: '#F8F9FF',
    borderColor: '#CCCCCC',
    borderRadius: 14,
    borderWidth: 0.25,
    color: '#000000',
    flex: 1,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    maxHeight: 97,
    minHeight: 46,
    padding: 10,
    textAlignVertical: 'top',
  },
  send: {
    alignItems: 'center',
    backgroundColor: '#F8F9FF',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 46,
    width: 46,
  },
  sendPressed: { opacity: 0.8 },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: '#056038', fontFamily, fontSize: 24, fontWeight: 400 },
});

const markdownStyles = {
  body: {
    ...styles.messageText,
    fontFamily,
    textAlign: 'left' as const,
    width: '100%',
  },
  bullet_list: { marginTop: 4 },
  code_block: {
    backgroundColor: '#EEF0F6',
    borderRadius: 8,
    color: '#123456',
    fontFamily,
    padding: 10,
  },
  heading1: {
    color: '#123456',
    fontFamily,
    fontSize: 23,
    fontWeight: 400,
    textAlign: 'left' as const,
  },
  heading2: {
    color: '#123456',
    fontFamily,
    fontSize: 20,
    fontWeight: 400,
    textAlign: 'left' as const,
  },
  heading3: {
    color: '#123456',
    fontFamily,
    fontSize: 18,
    fontWeight: 400,
    textAlign: 'left' as const,
  },
  paragraph: { fontFamily, marginTop: 0, textAlign: 'left' as const },
};
