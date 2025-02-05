/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from "vscode";
import * as fetchAPI from "./fetchAPI";
import * as userLogin from "./userLogin";
import { marked } from "marked"; // Markdown parser documentation: https://marked.js.org/
import * as estate from "./estate";
import * as crlf from "./crlf";
import ChatHistoryProvider from "./chatHistory";

export class ChatTab implements vscode.WebviewViewProvider {
  // public static current_tab: ChatTab | undefined;
  // private _disposables: vscode.Disposable[] = [];
  _view?: vscode.WebviewView;
  public messages: [string, string][];
  public cancellationTokenSource: vscode.CancellationTokenSource;
  public working_on_attach_code: string = "";
  public working_on_snippet_code: string = "";
  public working_on_snippet_range: vscode.Range | undefined = undefined;
  public working_on_snippet_editor: vscode.TextEditor | undefined = undefined;
  public working_on_snippet_column: vscode.ViewColumn | undefined = undefined;
  public model_to_thirdparty: { [key: string]: boolean };
  private chatHistoryProvider: ChatHistoryProvider;
  private chatId: string = "";

  //now constructor will only be called via extension.ts()
  constructor(
    private readonly _context: any, //add _context to constructor
    chatHistoryProvider: ChatHistoryProvider,
    chatId: string
  ) {
    this.messages = [];
    this.model_to_thirdparty = {};
    this.cancellationTokenSource = new vscode.CancellationTokenSource();
    this.chatHistoryProvider = chatHistoryProvider;
    if (chatId === "" || chatId === undefined) {
      this.chatId = this.chatHistoryProvider.generateChatId();
    }
  }

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext<unknown>,
    token: vscode.CancellationToken
  ) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    };

    webviewView.webview.html = this._get_html_for_webview_no_login(
      webviewView.webview
    );

    vscode.commands.registerCommand("workbench.action.focusChatSideBar", () => {
      webviewView.webview.postMessage({ command: "focus" });
    });

    this._view.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "open-new-file": {
          vscode.workspace.openTextDocument().then((document) => {
            vscode.window
              .showTextDocument(document, vscode.ViewColumn.Active)
              .then((editor) => {
                editor.edit((editBuilder) => {
                  editBuilder.insert(new vscode.Position(0, 0), data.value);
                });
              });
          });
          break;
        }
        case "diff-paste-back": {
          if (!this.working_on_snippet_editor) {
            return;
          }
          await vscode.window.showTextDocument(
            this.working_on_snippet_editor.document,
            this.working_on_snippet_column
          );
          let state = estate.state_of_document(
            this.working_on_snippet_editor.document
          );
          if (!state) {
            return;
          }
          let editor = state.editor;
          if (state.get_mode() !== estate.Mode.Normal) {
            return;
          }
          if (!this.working_on_snippet_range) {
            return;
          }
          let verify_snippet = editor.document.getText(
            this.working_on_snippet_range!
          );
          if (verify_snippet !== this.working_on_snippet_code) {
            return;
          }
          let text = editor.document.getText();
          let snippet_ofs0 = editor.document.offsetAt(
            this.working_on_snippet_range.start
          );
          let snippet_ofs1 = editor.document.offsetAt(
            this.working_on_snippet_range.end
          );
          let modif_doc: string =
            text.substring(0, snippet_ofs0) +
            data.value +
            text.substring(snippet_ofs1);
          [modif_doc] = crlf.cleanup_cr_lf(modif_doc, []);
          state.showing_diff_modif_doc = modif_doc;
          state.showing_diff_move_cursor = true;
          estate.switch_mode(state, estate.Mode.Diff);
          break;
        }
        case "question-posted-within-tab": {
          await this.chat_post_question(
            data.chat_question,
            data.chat_model,
            data.chat_model_function,
            data.chat_attach_file
          );
          //this.messages.forEach((i) => console.log(i));
          break;
        }
        case "stop-clicked": {
          this.cancellationTokenSource.cancel();
          break;
        }
        case "reset-messages": {
          let removed = this.messages.length - data.messages_backup.length;
          this.messages = data.messages_backup;
          while (removed) {
            this.chatHistoryProvider.popLastMessageFromChat(
              this.chatId,
              true,
              true
            );
            removed--;
          }
          break;
        }
      }
    });
    //add onDidRecieveMessage here
  }

  public update_webview_html(is_user_logged_in: boolean) {
    if (!this._view) {
      return;
    }
    if (is_user_logged_in) {
      this._view.webview.html = this._get_html_for_webview(this._view.webview);
    } else {
      this._view.webview.html = this._get_html_for_webview_no_login(
        this._view.webview
      );
    }
  }
  /*
  if (global.user_logged_in === "") {
      global.chat_panel?.update_webview_html(false);
    } else {
      global.chat_panel?.update_webview_html(true);
      await global.chat_panel?.activate_from_outside(
        "",
        vscode.window.activeTextEditor,
        false,
        "",
        "",
        false,
        "",
        undefined,
        undefined
      );
    }
  */

  public async activate_from_outside(
    question: string,
    editor: vscode.TextEditor | undefined,
    attach_default: boolean,
    use_model: string,
    use_model_function: string,
    old_chat: boolean,
    chatId: string,
    questions: string[] | undefined,
    answers: string[] | undefined
  ) {
    if (!this._view) {
      console.log("No view found for chat!!");
      return;
    }

    let context: vscode.ExtensionContext | undefined = global.global_context;
    if (!context) {
      return;
    }

    if (chatId === "") {
      chatId = this.chatHistoryProvider.generateChatId();
    }
    this.chatId = chatId;

    /*
    const panel = vscode.window.createWebviewPanel(
      "refact-chat-tab",
      "Refact.ai Chat",
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );
    panel.iconPath = vscode.Uri.file(
      context.asAbsolutePath("images/discussion-bubble.svg")
    );*/

    /*let free_floating_tab = new ChatTab(
      this._view,
      context.extensionUri,
      chatHistoryProvider,
      chatId,
      context
    );*/

    let free_floating_tab = this;
    let code_snippet = "";
    free_floating_tab.working_on_snippet_range = undefined;
    free_floating_tab.working_on_snippet_editor = undefined;
    free_floating_tab.working_on_snippet_column = undefined;
    if (!use_model) {
      [use_model, use_model_function] = await chat_model_get();
    }
    let fireup_message = {
      command: "chat-set-fireup-options",
      chat_models: [] as [string, string][],
      chat_use_model: use_model,
      chat_use_model_function: use_model_function,
      chat_attach_file: "",
      chat_attach_default: false,
      manual_infurl: vscode.workspace.getConfiguration().get("refactai.infurl"),
    };

    if (global.longthink_functions_today) {
      const keys = Object.keys(global.longthink_functions_today);
      for (let i = 0; i < keys.length; i++) {
        let key = keys[i];
        if (key.includes("chat-") || key.includes("-chat")) {
          let function_dict = global.longthink_functions_today[key];
          let model = function_dict.model;
          if (model === "open-chat") {
            // TODO: for backward compatibility, remove this later
            model = "gpt3.5";
          }
          fireup_message["chat_models"].push([
            model,
            function_dict.function_name,
          ]);
          free_floating_tab.model_to_thirdparty[model] =
            !!function_dict.thirdparty;
        }
      }
      if (fireup_message["chat_models"].length === 0 && !global.chat_v1_style) {
        fireup_message["chat_models"] = [["gpt3.5", "chat"]];
      }
    }
    if (editor) {
      let selection = editor.selection;
      let empty =
        selection.start.line === selection.end.line &&
        selection.start.character === selection.end.character;
      if (!empty) {
        let last_line_empty = selection.end.character === 0;
        selection = new vscode.Selection(
          selection.start.line,
          0,
          selection.end.line,
          last_line_empty ? 0 : 999999
        );
        code_snippet = editor.document.getText(selection);
        free_floating_tab.working_on_snippet_range = selection;
        free_floating_tab.working_on_snippet_editor = editor;
        free_floating_tab.working_on_snippet_column = editor.viewColumn;
      }
      let fn = editor.document.fileName;
      let short_fn = fn.replace(/.*[\/\\]/, "");
      fireup_message["chat_attach_file"] = short_fn;
      fireup_message["chat_attach_default"] = attach_default;
      let pos0 = selection.start;
      let pos1 = selection.end;
      let attach = "";
      while (1) {
        let attach_test = editor.document.getText(new vscode.Range(pos0, pos1));
        if (attach_test.length > 2000) {
          break;
        }
        attach = attach_test;
        let moved = false;
        if (pos0.line > 0) {
          pos0 = new vscode.Position(pos0.line - 1, 0);
          moved = true;
        }
        if (pos1.line < editor.document.lineCount - 1) {
          pos1 = new vscode.Position(pos1.line + 1, 999999);
          moved = true;
        }
        if (!moved) {
          break;
        }
      }
      free_floating_tab.working_on_attach_code = attach;
    }
    free_floating_tab.working_on_snippet_code = code_snippet;

    if (question) {
      console.log("posted question from question");
      if (code_snippet) {
        question = "```\n" + code_snippet + "\n```\n" + question;
      }
      await free_floating_tab.chat_post_question(
        question,
        use_model,
        use_model_function,
        !!code_snippet
      );
    } else {
      let pass_dict = {
        command: "chat-set-question-text",
        value: { question: "" },
      };
      if (code_snippet) {
        pass_dict["value"]["question"] = "```\n" + code_snippet + "\n```\n";
      }
      await this._view.webview.postMessage(pass_dict);
    }

    await this._view.webview.postMessage(fireup_message);
    if (old_chat && questions) {
      let messages_backup: [string, string][] = [];
      //console.log("adding old chat");

      for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        const answer = answers && answers.length > i ? answers[i] : null;

        free_floating_tab.messages.push(["user", question]);
        await free_floating_tab._question_to_div(question, messages_backup);
        messages_backup.push(["user", question]);

        if (answer) {
          free_floating_tab.messages.push(["assistant", answer]);
          await free_floating_tab._answer_to_div(answer, messages_backup);
          messages_backup.push(["assistant", answer]);
        }
      }

      //end streaming once all old q has been posted
      await this._view!.webview.postMessage({
        command: "chat-end-streaming",
      });
    }

    console.log("activation finished");
  }

  // public dispose()
  // {
  //     ChatTab.current_tab = undefined;
  //     this.web_panel.dispose();
  //     while (this._disposables.length) {
  //         const disposable = this._disposables.pop();
  //         if (disposable) {
  //             disposable.dispose();
  //         }
  //     }
  // }

  private async _question_to_div(
    question: string,
    messages_backup: [string, string][]
  ) {
    let valid_html = false;
    let html = "";
    try {
      html = marked.parse(question);
      valid_html = true;
    } catch (e) {
      valid_html = false;
    }
    if (!valid_html) {
      html = question;
    }
    //console.log("question-html: " + html);
    await this._view!.webview.postMessage({
      command: "chat-post-question",
      question_html: html,
      question_raw: question,
      messages_backup: messages_backup,
    });
  }

  private async _answer_to_div(
    answer: string,
    messages_backup: [string, string][]
  ) {
    let valid_html = false;
    let html = "";
    try {
      html = marked.parse(answer);
      valid_html = true;
    } catch (e) {
      valid_html = false;
    }
    if (!valid_html) {
      html = answer;
    }
    await this._view!.webview.postMessage({
      command: "chat-post-answer",
      answer_html: html,
      answer_raw: answer,
      messages_backup: messages_backup,
    });
  }

  async chat_post_question(
    question: string,
    model: string,
    model_function: string,
    attach_file: boolean
  ) {
    if (!this._view!) {
      return false;
    }
    let login = await userLogin.inference_login();
    if (!login) {
      this._view!.webview.postMessage({
        command: "chat-post-answer",
        answer_html:
          "The inference server isn't working. Possible reasons: your internet connection is down, you didn't log in, or the Refact.ai inference server is currently experiencing issues.",
        answer_raw: "",
        have_editor: false,
      });
      return;
    }

    chat_model_set(model, model_function); // successfully used model, save it

    this.cancellationTokenSource = new vscode.CancellationTokenSource();
    let cancelToken = this.cancellationTokenSource.token;

    if (this.messages.length === 0) {
      // find first 15 characters, non space, non newline, non special character
      let first_normal_char_index = question.search(/[^ \n\r\t`]/);
      let first_15_characters = question.substring(
        first_normal_char_index,
        first_normal_char_index + 15
      );
      let first_16_characters = question.substring(
        first_normal_char_index,
        first_normal_char_index + 16
      );
      if (first_15_characters !== first_16_characters) {
        first_15_characters += "…";
      }
      this._view!.title = first_15_characters;
      if (attach_file) {
        this.messages.push(["user", this.working_on_attach_code]);

        this.messages.push([
          "assistant",
          "Thanks for context, what's your question?",
        ]);
      }
    }

    if (
      this.messages.length > 0 &&
      this.messages[this.messages.length - 1][0] === "user"
    ) {
      this.messages.length -= 1;
    }

    let messages_backup = this.messages.slice();

    //local save + globalStorage save question
    this.messages.push(["user", question]);
    await this.chatHistoryProvider.addMessageToChat(
      this.chatId,
      question,
      "",
      model,
      model_function,
      this._view!.title || ""
    );

    if (this.messages.length > 10) {
      this.messages.shift();
      this.messages.shift(); // so it always starts with a user
    }
    await this._question_to_div(question, messages_backup);
    //add question to history
    this._view!.webview.postMessage({
      command: "chat-post-answer",
      answer_html: "⏳",
      answer_raw: "",
      have_editor: false,
    });
    await fetchAPI.wait_until_all_requests_finished();

    //add to history once all requests are finished

    let answer = "";
    let stack_web_panel = this._view;
    let stack_this = this;

    async function _streaming_callback(json: any) {
      if (json === undefined) {
        return;
      }
      if (cancelToken.isCancellationRequested) {
        console.log(["chat request is cancelled, new data is coming", json]);
        return;
      } else {
        let delta = "";
        if (json && json["choices"]) {
          let choice0 = json["choices"][0];
          delta = choice0["delta"];
        }
        if (json && json["delta"]) {
          // TODO: remove this after inference server is updated
          delta = json["delta"];
        }
        if (delta) {
          answer += delta;
          let valid_html = false;
          let html = "";
          try {
            let raw_html = answer;
            let backtick_backtick_backtick_count = (answer.match(/```/g) || [])
              .length;
            if (backtick_backtick_backtick_count % 2 === 1) {
              raw_html = answer + "\n```";
            }
            html = marked.parse(raw_html);
            valid_html = true;
          } catch (e) {
            console.log("error during steam callback:" + e);
            valid_html = false;
          }

          if (valid_html) {
            await stack_web_panel.webview.postMessage({
              command: "chat-post-answer",
              answer_html: html,
              answer_raw: answer,
              have_editor: Boolean(stack_this.working_on_snippet_editor),
            });
            // console.log(["assistant", answer]);
          }
        }
        if (json && json["metering_balance"]) {
          global.user_metering_balance = json["metering_balance"];
          if (global.side_panel) {
            global.side_panel.update_webview();
          }
        }
      }
    }

    async function _streaming_end_callback(any_error: boolean) {
      // stack_this.web_panel.reveal();
      console.log("streaming end callback, error: " + any_error);
      if (any_error) {
        let backup_user_phrase = "";
        for (
          let i = stack_this.messages.length - 1;
          i < stack_this.messages.length;
          i++
        ) {
          if (i >= 0) {
            if (stack_this.messages[i][0] === "user") {
              backup_user_phrase = stack_this.messages[i][1];
              stack_this.messages.length -= 1;
              break;
            }
          }
        }
        console.log("backup_user_phrase:" + backup_user_phrase);
        await stack_this._view!.webview.postMessage({
          command: "chat-error-streaming",
          backup_user_phrase: backup_user_phrase,
        });
      } else {
        stack_this.messages.push(["assistant", answer]);
        //console.log(answer);
        await stack_this.chatHistoryProvider.addMessageToChat(
          stack_this.chatId,
          "",
          answer,
          model,
          model_function,
          stack_this._view!.title || ""
        );

        await stack_this._view!.webview.postMessage({
          command: "chat-end-streaming",
        });
      }
    }

    let request = new fetchAPI.PendingRequest(undefined, cancelToken);
    request.set_streaming_callback(
      _streaming_callback,
      _streaming_end_callback
    );
    let third_party = true;
    third_party = this.model_to_thirdparty[model];

    request.supply_stream(
      ...fetchAPI.fetch_chat_promise(
        cancelToken,
        "chat-tab",
        this.messages,
        model_function,
        model,
        [],
        third_party
      )
    );
  }

  private _get_html_for_webview_no_login(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <!--
            Use a content security policy to only allow loading images from https or from our extension directory,
            and only allow scripts that have a specific nonce.
        -->
        <meta http-equiv="Content-Security-Policy" content="style-src ${webview.cspSource}; img-src 'self' data: https:; script-src; style-src-attr 'sha256-tQhKwS01F0Bsw/EwspVgMAqfidY8gpn/+DKLIxQ65hg=' 'unsafe-hashes';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">

        <title>Refact.ai Chat</title>
    </head>
    <body>
        <div class="refactcss-chat">
            <h2 class="refactcss-chat__title">Refact.ai Chat</h2>
            <div class="no_login_content">
                <p>Waiting For Login ... </p>
            </div>
        </div>        
    </body>
    </html>
    `;
  }

  private _get_html_for_webview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, "assets", "chat.js")
    );
    const styleMainUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, "assets", "chat.css")
    );
    const prismJsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, "assets", "prism.js")
    );
    const prismJsCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, "assets", "prism.css")
    );
    const nonce = ChatTab.getNonce();

    return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <!--
                    Use a content security policy to only allow loading images from https or from our extension directory,
                    and only allow scripts that have a specific nonce.
                -->
                <meta http-equiv="Content-Security-Policy" content="style-src ${webview.cspSource}; img-src 'self' data: https:; script-src 'nonce-${nonce}'; style-src-attr 'sha256-tQhKwS01F0Bsw/EwspVgMAqfidY8gpn/+DKLIxQ65hg=' 'unsafe-hashes';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">

                <title>Refact.ai Chat</title>
                <link href="${styleMainUri}" rel="stylesheet">
                <link href="${prismJsCssUri}" rel="stylesheet">
                <script nonce="${nonce}" src="${prismJsUri}" data-manual></script>
            </head>
            <body>
                <div class="refactcss-chat">
                    <h2 class="refactcss-chat__title">Refact.ai Chat</h2>
                    <div class="refactcss-chat__wrapper">
                        <div class="refactcss-chat__content"></div>
                        <div class="refactcss-chat__panel">
                            <div class="refactcss-chat__controls">
                                <div><input type="checkbox" id="chat-attach" name="chat-attach"><label id="chat-attach-label" for="chat-attach">Attach file</label></div>
                                <div class="refactcss-chat__model">Use model:<select id="chat-model"></select></div>
                            </div>
                            <div class="refactcss-chat__commands">
                                <button id="chat-stop" class="refactcss-chat__stop"><span></span>Stop&nbsp;generating</button>
                                <textarea id="chat-input" class="refactcss-chat__input"></textarea>
                                <button id="chat-send" class="refactcss-chat__button"><span></span></button>
                            </div>
                        </div>
                    </div>
                </div>                
                <script nonce="${nonce}" src="${scriptUri}"></script>
                <script nonce="${nonce}">
                  Prism.highlightAll();
                </script>
            </body>
            </html>`;
  }

  static getNonce() {
    let text = "";
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}

export async function chat_model_get(): Promise<[string, string]> {
  let context: vscode.ExtensionContext | undefined = global.global_context;
  if (!context) {
    return ["", ""];
  }
  let chat_model_ = await context.globalState.get("chat_model");
  let chat_model_function_ = await context.globalState.get(
    "chat_model_function"
  );
  let chat_model: string = "";
  if (typeof chat_model_ !== "string") {
    chat_model = "";
  } else {
    chat_model = chat_model_;
  }
  let chat_model_function: string = "";
  if (typeof chat_model_function_ !== "string") {
    chat_model_function = "";
  } else {
    chat_model_function = chat_model_function_;
  }
  return [chat_model, chat_model_function];
}

export async function chat_model_set(
  chat_model: string,
  model_function: string
) {
  let context: vscode.ExtensionContext | undefined = global.global_context;
  if (!context) {
    return;
  }
  if (!chat_model) {
    return;
  }
  await context.globalState.update("chat_model", chat_model);
  await context.globalState.update("chat_model_function", model_function);
}

export default ChatTab;
