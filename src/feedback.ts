import * as vscode from 'vscode';

const FEEDBACK_URL = 'https://github.com/petstuk/kql-assistant/discussions';
const DISMISSED_KEY = 'feedbackPromptDismissed';
let hasShownThisSession = false;
let globalContext: vscode.ExtensionContext | undefined;

export function initializeFeedback(context: vscode.ExtensionContext) {
    globalContext = context;
}

export async function showFeedbackPrompt(context?: vscode.ExtensionContext) {
    // Guard: prevent multiple prompts in same session (set early to avoid race conditions)
    if (hasShownThisSession) {
        return;
    }
    hasShownThisSession = true;

    const ctx = context || globalContext;
    if (!ctx) {
        console.error('Feedback module not initialized with context');
        hasShownThisSession = false; // Reset so it can try again if context becomes available
        return;
    }

    // Check if user has already responded or asked not to be bothered
    if (ctx.globalState.get<boolean>(DISMISSED_KEY)) {
        return;
    }

    const answer = await vscode.window.showInformationMessage(
        'Enjoying your KQL Assistant? I’d love your feedback or ideas for what to build next.',
        'Share Feedback',
        'Later',
        'Don’t Ask Again'
    );

    if (answer === 'Share Feedback') {
        // Mark as dismissed so we don't ask again
        await ctx.globalState.update(DISMISSED_KEY, true);
        vscode.env.openExternal(vscode.Uri.parse(FEEDBACK_URL));
    } else if (answer === 'Don’t Ask Again') {
        // Mark as dismissed
        await ctx.globalState.update(DISMISSED_KEY, true);
    }
    // If answer is 'Later' or undefined (user dismissed without clicking),
    // do nothing - the prompt will appear again in a future session.
}
