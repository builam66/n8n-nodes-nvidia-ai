import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class NvidiaApi implements ICredentialType {
	name = 'nvidiaApi';

	displayName = 'Nvidia API';

    icon: Icon = { light: 'file:../icons/nvidia.svg', dark: 'file:../icons/nvidia.dark.svg' };

	documentationUrl = 'https://build.nvidia.com/explore/discover';
    
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'The API key for Nvidia Integrate API',
		},
	];

    authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

    test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://integrate.api.nvidia.com/v1',
			url: '/models',
			method: 'GET',
		},
	};
}