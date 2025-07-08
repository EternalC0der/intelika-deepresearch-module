import { get } from 'env-var'
export const OPENAI_API_KEY = get('OPENAI_API_KEY').required().asString()
export const GOOGLE_GENERATIVE_AI_API_KEY = get('GOOGLE_GENERATIVE_AI_API_KEY').required().asString()
export const EXA_API_KEY = get('EXA_API_KEY').required().asString()