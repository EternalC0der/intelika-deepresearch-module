import { tool } from "ai";

/**
 * Context provider interface for accessing dynamic data
 * Tools can define their own context type
 */
interface IContextProvider<TContext = any> {
  getContext(): TContext | null | Promise<TContext | null>;
}

/**
 * Configuration options for BaseAITool
 */
interface BaseAIToolConfig<TBeforeHook, TAfterHook, TContext> {
  hooks?: {
    beforeExecute?: TBeforeHook;
    afterExecute?: TAfterHook;
  };
  context?: TContext;
  contextProvider?: IContextProvider<TContext>;
}

/**
 * Generic base class for AI tools with hook support and context injection
 * Each tool class can define its own hook types and context type when extending this base
 */
abstract class BaseAITool<TBeforeHook = any, TAfterHook = any, TContext = any> {
  protected beforeExecute?: TBeforeHook;
  protected afterExecute?: TAfterHook;
  protected staticContext?: TContext;
  protected contextProvider?: IContextProvider<TContext>;

  constructor(config?: BaseAIToolConfig<TBeforeHook, TAfterHook, TContext>) {
    this.beforeExecute = config?.hooks?.beforeExecute;
    this.afterExecute = config?.hooks?.afterExecute;
    this.staticContext = config?.context;
    this.contextProvider = config?.contextProvider;
  }

  /**
   * Abstract getter that each tool class must implement
   * Returns the actual AI tool instance
   */
  abstract get tool(): any;

  /**
   * Get the current context (static or from provider)
   * @returns The context object, null, or undefined if not available
   */
  protected async getContext(): Promise<TContext | null | undefined> {
    if (this.contextProvider) {
      return await this.contextProvider.getContext();
    }
    return this.staticContext;
  }

  /**
   * Set the before execute hook
   * @param hook - Function to execute before the main tool execution
   */
  onBeforeExecute(hook: TBeforeHook): void {
    this.beforeExecute = hook;
  }

  /**
   * Set the after execute hook
   * @param hook - Function to execute after the main tool execution
   */
  onAfterExecute(hook: TAfterHook): void {
    this.afterExecute = hook;
  }

  /**
   * Set or update the static context
   * @param context - The context object
   */
  setContext(context: TContext): void {
    this.staticContext = context;
  }

  /**
   * Set or update the context provider
   * @param provider - The context provider
   */
  setContextProvider(provider: IContextProvider<TContext>): void {
    this.contextProvider = provider;
  }

  /**
   * Clear all registered hooks
   */
  clearAllHooks(): void {
    this.beforeExecute = undefined;
    this.afterExecute = undefined;
  }

  /**
   * Clear context and context provider
   */
  clearContext(): void {
    this.staticContext = undefined;
    this.contextProvider = undefined;
  }

  /**
   * Check if a before execute hook is registered
   */
  protected hasBeforeHook(): boolean {
    return this.beforeExecute !== undefined;
  }

  /**
   * Check if an after execute hook is registered
   */
  protected hasAfterHook(): boolean {
    return this.afterExecute !== undefined;
  }

  /**
   * Check if context is available (static or provider)
   */
  protected hasContext(): boolean {
    return (
      this.staticContext !== undefined || this.contextProvider !== undefined
    );
  }
}

export default BaseAITool;
export type { IContextProvider, BaseAIToolConfig };
