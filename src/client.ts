import { Message } from './types'
import * as wordCount from './utils'
import { createParser } from 'eventsource-parser'

export interface OnTextCallbackResult {
  // response content
  text: string
  // cancel for fetch
  cancel: () => void
}

export async function replay(
  apiKey: string,
  host: string,
  maxContextSize: string,
  maxTokens: string,
  modelName: string,
  temperature: number,
  msgs: Message[],
  onText?: (option: OnTextCallbackResult) => void,
  onError?: (error: Error) => void
) {
  if (msgs.length === 0) {
    throw new Error('No messages to replay')
  }
  const head = msgs[0].role === 'system' ? msgs[0] : undefined
  if (head) {
    msgs = msgs.slice(1)
  }

  const maxTokensNumber = Number(maxTokens)
  const maxLen = Number(maxContextSize)
  let totalLen = head ? wordCount.estimateTokens(head.content) : 0

  let prompts: Message[] = []
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]
    const msgTokenSize: number = wordCount.estimateTokens(msg.content) + 200 // 200 作为预估的误差补偿
    if (msgTokenSize + totalLen > maxLen) {
      break
    }
    prompts = [msg, ...prompts]
    totalLen += msgTokenSize
  }
  if (head) {
    prompts = [head, ...prompts]
  }

  // fetch has been canceled
  let hasCancel = false
  // abort signal for fetch
  const controller = new AbortController()
  const cancel = () => {
    hasCancel = true
    controller.abort()
  }

  let fullText = ''
  try {
    const messages = prompts.map(msg => ({ role: msg.role, content: msg.content }))

    const config = {
      host,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages,
        model: modelName,
        max_tokens: maxTokensNumber,
        temperature,
        stream: true
      })
      // signal: controller.signal
    }
    console.log('🚀 >> config:', config)

    const response = await fetch(`${host}/api/chatGpt/gptTuro`, config)
    console.log('🚀 >> response:', response)
    await handleSSE(response, text => {
      console.log('🚀 >> response:', response)
      console.log('🚀 >> text:', text)

      if (!response.ok) {
        throw new Error(' response ok error')
      }
      if (response.status !== 200) {
        throw new Error(`Error from OpenAI: ${response.status} ${response.statusText}`)
      }
      if (!response.body) {
        throw new Error('No response body')
      }

      const parsedText = text
      console.log('🚀 >> parsedText:', parsedText)

      if (parsedText === '响应已结束') return

      if (parsedText !== undefined) {
        fullText += parsedText
        if (onText) {
          onText({ text: fullText, cancel })
        }
      }
    })
  } catch (error) {
    // if a cancellation is performed
    // do not throw an exception
    // otherwise the content will be overwritten.
    if (hasCancel) {
      return
    }
    if (onError) {
      onError(error as any)
    }
    throw error
  }

  return fullText
}

export async function handleSSE(response: Response, onMessage: (message: string) => void) {
  console.log('🚀 response', !response.ok, response.status !== 200, !response.body)

  if (!response.ok) {
    throw new Error('No response ok')
  }
  if (response.status !== 200)
    throw new Error(`Error from OpenAI: ${response.status} ${response.statusText}`)

  if (!response.body) throw new Error('No response body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    const chunk = decoder.decode(value)
    console.log('Received chunk:', chunk)
    onMessage(chunk)
  }

  // const parser = createParser(event => {
  //   console.log('🚀  event:', event)
  //   if (event.type === 'event') {
  //     onMessage(event.data)
  //   }
  // })
  // for await (const chunk of iterableStreamAsync(response.body)) {
  //   const str = new TextDecoder().decode(chunk)
  //   parser.feed(str)
  // }
}

export async function* iterableStreamAsync(
  stream: ReadableStream
): AsyncIterableIterator<Uint8Array> {
  const reader = stream.getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        return
      } else {
        yield value
      }
    }
  } finally {
    reader.releaseLock()
  }
}
