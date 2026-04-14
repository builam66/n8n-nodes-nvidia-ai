import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionTypes,
	NodeOperationError,
    IHttpRequestOptions,
} from 'n8n-workflow';

export class NvidiaAi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Nvidia AI',
		name: 'nvidiaAi',
		icon: { light: 'file:../../icons/nvidia.svg', dark: 'file:../../icons/nvidia.dark.svg' },
		group: ['transform'],
		version: 1,
        subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Use Nvidia AI models (OpenAI compatible)',
		defaults: {
			name: 'Nvidia AI',
		},
        usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'nvidiaApi',
				required: true,
			},
		],
        requestDefaults: {
			baseURL: 'https://integrate.api.nvidia.com/v1',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
		},
		properties: [
			{
				displayName: 'Model',
				name: 'model',
				type: 'string',
				default: '',
				required: true,
				description: 'The model name to use (e.g., gpt-4o, gpt-3.5-turbo, etc.)',
			},
			{
				displayName: 'Messages',
				name: 'messages',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				description: 'The list of messages to send to the model, each with a role and content',
				options: [
					{
						name: 'messageValues',
						displayName: 'Message',
						values: [
							{
								displayName: 'Role',
								name: 'role',
								type: 'options',
								options: [
									{ name: 'System', value: 'system' },
									{ name: 'User', value: 'user' },
									{ name: 'Assistant', value: 'assistant' },
								],
								default: 'user',
							},
							{
								displayName: 'Content',
								name: 'content',
								type: 'string',
								typeOptions: { rows: 4 },
								default: '',
							},
						],
					},
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
                    {
						displayName: 'Chat Template Kwargs (JSON)',
						name: 'chat_template_kwargs',
						type: 'json',
						default: '{"thinking":true}',
						description: 'Ex: {"thinking":true}',
					},
					{
						displayName: 'Max Tokens',
						name: 'max_tokens',
						type: 'number',
						default: 8192,
					},
					{
						displayName: 'Stream',
						name: 'stream',
						type: 'boolean',
						default: true,
					},
					{
						displayName: 'Temperature',
						name: 'temperature',
						type: 'number',
						default: 0.2,
					},
					{
						displayName: 'Top P',
						name: 'top_p',
						type: 'number',
						default: 0.7,
					},
				],
			},
		],
	};

async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const model = this.getNodeParameter('model', i) as string;
				
				const messagesRaw = this.getNodeParameter('messages', i) as {
					messageValues?: Array<{ role: string; content: string }>;
				};
				const options = this.getNodeParameter('options', i) as {
					temperature?: number;
					top_p?: number;
					max_tokens?: number;
					chat_template_kwargs?: string | Record<string, unknown>;
					stream?: boolean;
				};

				const messages = messagesRaw.messageValues
					? messagesRaw.messageValues.map((msg) => ({
							role: msg.role,
							content: msg.content,
                    }))
					: [];

				let chat_template_kwargs: Record<string, unknown> | undefined = undefined;
				if (options.chat_template_kwargs) {
					try {
						chat_template_kwargs = typeof options.chat_template_kwargs === 'string'
							? (JSON.parse(options.chat_template_kwargs) as Record<string, unknown>)
							: (options.chat_template_kwargs as Record<string, unknown>);
					} catch {
						throw new NodeOperationError(this.getNode(), 'chat_template_kwargs phải là một JSON hợp lệ.');
					}
				}
				const isStream = options.stream !== false;

				const requestBody: {
					model: string;
					messages: Array<{ role: string; content: string }>;
					temperature: number;
					top_p: number;
					max_tokens: number;
					stream: boolean;
					chat_template_kwargs?: Record<string, unknown>;
				} = {
					model,
					messages,
					temperature: options.temperature ?? 0.2,
					top_p: options.top_p ?? 0.7,
					max_tokens: options.max_tokens ?? 8192,
					stream: isStream,
				};

				if (chat_template_kwargs) {
					requestBody.chat_template_kwargs = chat_template_kwargs;
				}

				const requestOptions: IHttpRequestOptions = {
					method: 'POST',
					url: '/chat/completions',
					body: requestBody,
					json: !isStream,
				};

				if (isStream) {
					requestOptions.headers = {
						'Accept': 'text/event-stream',
						'Content-Type': 'application/json',
					};
					requestOptions.body = JSON.stringify(requestBody);
				}

				const response = await this.helpers.httpRequestWithAuthentication.call(
					this,
					'nvidiaApi',
					requestOptions
				);

				let fullContent = '';
				let fullReasoning = '';

				if (isStream) {
					const lines = (response as string).split('\n');
					for (const line of lines) {
						const trimmedLine = line.trim();
						if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
							try {
								const dataStr = trimmedLine.substring(6);
								const dataObj = JSON.parse(dataStr) as {
									choices?: Array<{
										delta?: {
											content?: string;
											reasoning_content?: string;
										};
									}>;
								};
								const delta = dataObj.choices?.[0]?.delta || {};

								if (delta.reasoning_content) {
									fullReasoning += delta.reasoning_content;
								}
								if (delta.content) {
									fullContent += delta.content;
								}
							} catch {
								// Bỏ qua các chunks lỗi/không parse được
							}
						}
					}
				} else {
					const resObj = response as {
						choices?: Array<{
							message?: {
								content?: string;
								reasoning_content?: string;
							};
						}>;
					};
					fullContent = resObj.choices?.[0]?.message?.content || '';
					fullReasoning = resObj.choices?.[0]?.message?.reasoning_content || '';
				}

				returnData.push({
					json: {
						model: model,
						content: fullContent,
						reasoning: fullReasoning,
						metadata: {
							hasReasoning: fullReasoning.length > 0,
						},
					},
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message } });
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error);
			}
		}

		return [returnData];
	}
}