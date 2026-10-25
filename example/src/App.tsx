import { useEffect, useRef, useState } from 'react';
import type { ElementRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Keyboard,
  Modal,
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
import { conversationLimits, promptWithHistory } from './conversation';
import {
  createChat,
  deleteChat,
  type Chat,
  type ChatMessage,
} from './chatStorage';
import { useChatLibrary } from './useChatLibrary';

const modelAsset = 'Qwen3VL-2B-Instruct-Q4_K_M.gguf';
const logoAsset = require('../assets/logo.png');
const fontFamily = Platform.OS === 'android' ? 'EBGaramond' : 'EB Garamond';

type Message = ChatMessage;
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
  const {
    library,
    status: storageStatus,
    error: storageError,
    commit,
    retry,
    isBusy: isStorageBusy,
  } = useChatLibrary();
  const activeChat = library.chats.find(
    (chat) => chat.id === library.activeChatId
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(false);
  const messagesList = useRef<FlatList<Message>>(null);
  const inputRef = useRef<ElementRef<typeof TextInput>>(null);
  const [pendingMessages, setPendingMessages] = useState<Message[]>([]);
  const messages = [...(activeChat?.messages ?? []), ...pendingMessages];
  const [input, setInput] = useState('');
  const [thinkingText, setThinkingText] = useState('Thinking');
  const [thinkingMessageId, setThinkingMessageId] = useState<string | null>(
    null
  );
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [animatedMessageId, setAnimatedMessageId] = useState<string | null>(
    null
  );
  const isSendingRef = useRef(false);
  const [state, setState] = useState<ModelState>({
    status: 'loading',
    error: null,
  });
  const chatsBusy = state.status === 'thinking' || storageStatus !== 'ready';

  function closeMenu() {
    menuOpenRef.current = false;
    setMenuOpen(false);
  }

  async function openChat(chat: Chat) {
    if (chatsBusy || isSendingRef.current || isStorageBusy()) return;
    setInput('');
    setCopiedMessageId(null);
    setAnimatedMessageId(null);
    setState((current) => ({ ...current, error: null }));
    closeMenu();
    await commit({
      ...library,
      activeChatId: chat.id,
      chats: library.chats.some((existing) => existing.id === chat.id)
        ? library.chats
        : [chat, ...library.chats],
    });
    scrollToBottom();
  }

  function confirmDelete(chat: Chat) {
    if (chatsBusy || isSendingRef.current || isStorageBusy()) return;
    Alert.alert(
      'Delete chat forever?',
      `"${chat.title}" and all its messages will be deleted forever. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete forever',
          style: 'destructive',
          onPress: () => {
            if (chatsBusy || isSendingRef.current || isStorageBusy()) return;
            if (chat.id === library.activeChatId) {
              setInput('');
              setCopiedMessageId(null);
              setAnimatedMessageId(null);
              setState((current) => ({ ...current, error: null }));
            }
            commit(deleteChat(library, chat.id));
          },
        },
      ]
    );
  }

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
      debug: false,
      ...conversationLimits,
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
    const loadedModel = model.current;
    if (
      !prompt ||
      !loadedModel ||
      isSendingRef.current ||
      isStorageBusy() ||
      storageStatus !== 'ready' ||
      state.status !== 'ready'
    ) {
      return;
    }

    isSendingRef.current = true;
    inputRef.current?.focus();
    setInput('');
    setState({ status: 'thinking', error: null });
    setThinkingText('Thinking');
    const thinkingId = `${Date.now()}-thinking`;
    setThinkingMessageId(thinkingId);
    const chat = activeChat ?? createChat();
    const userMessage: Message = {
      id: `${Date.now()}-user`,
      role: 'user',
      text: prompt,
    };
    setPendingMessages([
      userMessage,
      { id: thinkingId, role: 'assistant', text: 'Thinking' },
    ]);
    scrollToBottom();
    try {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      const { response, turns } = await promptWithHistory(
        loadedModel,
        chat.turns,
        prompt
      );
      const updatedChat: Chat = {
        ...chat,
        title: chat.messages.length === 0 ? prompt.slice(0, 60) : chat.title,
        updatedAt: Date.now(),
        messages: [
          ...chat.messages,
          userMessage,
          { id: thinkingId, role: 'assistant', text: response },
        ],
        turns,
      };
      setAnimatedMessageId(thinkingId);
      setPendingMessages([]);
      await commit({
        ...library,
        activeChatId: chat.id,
        chats: [
          updatedChat,
          ...library.chats.filter((existing) => existing.id !== chat.id),
        ],
      });
      setThinkingMessageId(null);
      setState({ status: 'ready', error: null });
    } catch (caughtError: unknown) {
      setPendingMessages([]);
      setThinkingMessageId(null);
      setInput((current) => current || prompt);
      setState({
        status: 'ready',
        error:
          caughtError instanceof Error
            ? caughtError.message
            : String(caughtError),
      });
    } finally {
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open chat menu"
                onPress={() => {
                  menuOpenRef.current = true;
                  setMenuOpen(true);
                  Keyboard.dismiss();
                }}
                style={styles.menuButton}
              >
                <View style={styles.menuLine} />
                <View style={styles.menuLine} />
                <View style={styles.menuLine} />
              </Pressable>
              <Image source={logoAsset} style={styles.logo} />
              <View style={styles.brandText}>
                <Text style={styles.title}>Thistle Lite</Text>
                <Text style={styles.subtitle}>
                  {activeChat?.title ?? 'New chat'}
                </Text>
              </View>
            </View>
          </View>
        </LinearGradient>
        {storageStatus === 'loading' || storageStatus === 'saving' ? (
          <Text style={styles.storageNotice}>
            {storageStatus === 'loading'
              ? 'Opening encrypted chats...'
              : 'Saving encrypted chats...'}
          </Text>
        ) : null}
        {storageError ? (
          <View>
            <Text accessibilityRole="alert" style={styles.error}>
              {storageError}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry encrypted chat storage"
              onPress={retry}
              style={styles.retryButton}
            >
              <Text style={styles.actionText}>Retry storage</Text>
            </Pressable>
          </View>
        ) : null}
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
                  {item.id === animatedMessageId ? (
                    <TypedAssistantMessage text={item.text} />
                  ) : (
                    <FormattedAssistantText text={item.text} />
                  )}
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
          ListFooterComponent={
            messages.length > 0 && state.error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {state.error}
              </Text>
            ) : undefined
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
              editable={
                storageStatus === 'ready' &&
                (state.status === 'ready' || state.status === 'thinking')
              }
              blurOnSubmit={false}
              onChangeText={setInput}
              onBlur={() => {
                if (
                  !menuOpenRef.current &&
                  (isSendingRef.current || state.status === 'thinking')
                ) {
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
              disabled={chatsBusy || state.status !== 'ready' || !input.trim()}
              onPressIn={() => {
                inputRef.current?.focus();
              }}
              onPress={sendMessage}
              style={({ pressed }) => [
                styles.send,
                pressed && styles.sendPressed,
                (chatsBusy || state.status !== 'ready' || !input.trim()) &&
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
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={closeMenu}
      >
        <View style={styles.menuOverlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close chat menu"
            onPress={closeMenu}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView style={styles.drawer} accessibilityViewIsModal>
            <View style={styles.drawerHeader}>
              <Text style={styles.drawerTitle}>Chats</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close chat menu"
                onPress={closeMenu}
                style={styles.menuButton}
              >
                <Text style={styles.actionText}>Close</Text>
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New chat"
              disabled={chatsBusy}
              onPress={() => openChat(createChat())}
              style={[styles.newChatButton, chatsBusy && styles.sendDisabled]}
            >
              <Text style={styles.actionText}>New chat</Text>
            </Pressable>
            {chatsBusy ? (
              <Text style={styles.storageNotice}>
                {state.status === 'thinking'
                  ? 'Wait for the response before changing chats.'
                  : 'Chat storage must be ready before changing chats.'}
              </Text>
            ) : null}
            <FlatList
              data={library.chats}
              keyExtractor={(chat) => chat.id}
              ListEmptyComponent={
                <Text style={styles.empty}>No saved chats yet.</Text>
              }
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.chatRow,
                    item.id === library.activeChatId && styles.selectedChat,
                  ]}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: item.id === library.activeChatId,
                      disabled: chatsBusy,
                    }}
                    disabled={chatsBusy}
                    onPress={() => openChat(item)}
                    style={styles.chatLink}
                  >
                    <Text numberOfLines={2} style={styles.actionText}>
                      {item.title}
                    </Text>
                    <Text style={styles.chatDate}>
                      {new Date(item.updatedAt).toLocaleString()}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete chat: ${item.title}`}
                    disabled={chatsBusy}
                    onPress={() => confirmDelete(item)}
                    style={styles.deleteButton}
                  >
                    <Text style={styles.deleteText}>Delete</Text>
                  </Pressable>
                </View>
              )}
            />
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  brandText: { flex: 1 },
  menuButton: { minHeight: 44, minWidth: 44, justifyContent: 'center', gap: 5 },
  menuLine: { width: 24, height: 2, backgroundColor: '#F8F9FF' },
  menuOverlay: { flex: 1, backgroundColor: '#00000066' },
  drawer: { width: '88%', maxWidth: 380, flex: 1, backgroundColor: '#F8F9FF' },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  drawerTitle: { fontFamily, fontSize: 28, color: '#004225' },
  actionText: { fontFamily, fontSize: 18, color: '#004225' },
  newChatButton: { padding: 16, borderBottomWidth: 1, borderColor: '#CCCCCC' },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  selectedChat: { backgroundColor: '#DCEDE3' },
  chatLink: { flex: 1, paddingVertical: 16 },
  chatDate: { fontFamily, fontSize: 12, color: '#666666', marginTop: 4 },
  deleteButton: { padding: 12 },
  deleteText: { fontFamily, color: '#9B1C1C', fontSize: 16 },
  storageNotice: {
    fontFamily,
    color: '#666666',
    padding: 12,
    textAlign: 'center',
  },
  retryButton: { alignSelf: 'center', padding: 12 },
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
