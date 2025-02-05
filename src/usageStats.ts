/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as fetchH2 from 'fetch-h2';
import * as fetchAPI from "./fetchAPI";
import * as userLogin from "./userLogin";

import { completion_metric_pipeline } from "./metricCompletion";
import { ApiFields } from './estate';


export async function report_success_or_failure(
    positive: boolean,
    scope: string,
    related_url: string,
    error_message: string | any,
    model_name: string | undefined,
) {
    let invalid_session = false;
    let timedout = false;
    let conn_refused = false;
    if (typeof error_message !== "string") {
        if (error_message.code && error_message.code.includes("INVALID_SESSION")) {
            invalid_session = true;
        }
        if (error_message.code && error_message.code.includes("ETIMEDOUT")) {
            timedout = true;
        }
        if (error_message.code && error_message.code.includes("ECONNREFUSED")) {
            conn_refused = true;
        }
        if (error_message instanceof Error && error_message.message) {
            error_message = error_message.message;
        } else {
            error_message = JSON.stringify(error_message);
        }
    }
    if (typeof error_message === "string") {
        if (error_message.includes("INVALID_SESSION")) {
            invalid_session = true;
        }
        if (error_message.includes("ETIMEDOUT") || error_message.includes("timed out")) {
            timedout = true;
        }
        if (error_message.includes("ECONNREFUSED")) {
            conn_refused = true;
        }
    }
    if (!positive) {
        await fetchH2.disconnectAll();
        await fetchAPI.non_verifying_ctx.disconnectAll();
    } else {
        global.last_positive_result = Date.now();
    }
    if (invalid_session || conn_refused) {
        userLogin.inference_login_force_retry();
        console.log(["INVALID_SESSION, ECONNREFUSED => inference_login_force_retry"]);
    }
    if (timedout) {
        userLogin.inference_login_force_retry();
        // console.log(["ETIMEDOUT => disconnectAll"]);
    }
    if (error_message.length > 200) {
        error_message = error_message.substring(0, 200) + "…";
    }
    if (model_name) {
        global.status_bar.url_and_model_worked(related_url, model_name);
    }
    global.status_bar.set_socket_error(!positive, error_message);
    if (userLogin.check_if_login_worked()) {
        if (global.side_panel) {
            global.side_panel.update_webview();
        }
    } else {
        if (global.side_panel) {
            global.side_panel.update_webview();
        }
        global.status_bar.url_and_model_worked("", "");
    }
    let error_message_json = JSON.stringify(error_message);
    let msg = `${positive ? "1" : "0"}\t${scope}\t${related_url}\t${error_message_json}`;  // tabs for field separation, still human readable
    // Typical msg:
    // 1  "completion"  https://inference.smallcloud.ai/v1/contrast  ""
    // 0  "completion"  https://inference.smallcloud.ai/v1/contrast  "Could not verify your API key (3)"
    console.log([msg]);
    let global_context: vscode.ExtensionContext|undefined = global.global_context;
    if (global_context !== undefined) {
        let count_msg: { [key: string]: number } | undefined = await global_context.globalState.get("usage_stats");
        if (typeof count_msg !== "object") {
            count_msg = {};
        }
        if (count_msg[msg] === undefined) {
            count_msg[msg] = 1;
        } else {
            count_msg[msg] += 1;
        }
        await global_context.globalState.update(
            "usage_stats",
            count_msg
        );
    }
}


export async function report_increase_a_counter(
    scope: string,
    counter_name: string,
) {
    let global_context: vscode.ExtensionContext|undefined = global.global_context;
    if (!global_context) {
        return;
    }
    console.log(["increase_a_counter", scope, counter_name]);
    // {"scope1": {"counter1": 5, "counter2": 6}, "scope2": {"counter1": 5, "counter2": 6}}
    let usage_counters: { [key: string]: { [key: string]: number } } | undefined = await global_context.globalState.get("usage_counters");
    if (typeof usage_counters !== "object") {
        usage_counters = {};
    }
    if (usage_counters[scope] === undefined) {
        usage_counters[scope] = {};
    }
    if (usage_counters[scope][counter_name] === undefined) {
        usage_counters[scope][counter_name] = 1;
    } else {
        usage_counters[scope][counter_name] += 1;
    }
    await global_context.globalState.update("usage_counters", usage_counters);
}


async function declutter_cm_file_states() {
    let files_limit = 5;
    let global_context: vscode.ExtensionContext|undefined = global.global_context;
    if (!global_context) {
        return;
    }
    let cm_file_states: {[key: string]: Array<{[key: string]: string}>} | undefined = await global_context.globalState.get("cm_file_states");
    let cm_last_used_files: Array<string> | undefined = await global_context.globalState.get("cm_last_used_files");
    if (!cm_file_states || !cm_last_used_files) {
        return;
    }
    let last_n_files = cm_last_used_files.slice(-files_limit);
    if (last_n_files.length === 0) {
        return;
    }
    let keys_delete = [];
    for (let [key, _] of Object.entries(cm_file_states)) {
        if (!last_n_files.includes(key)) {
            keys_delete.push(key);
        }
    }
    for (let key of keys_delete) {
        delete cm_file_states[key];
    }
    // if (Object.keys(cm_file_states).length === 0) {
    //     return;
    // }
    await global_context.globalState.update("cm_file_states", cm_file_states);
    await global_context.globalState.update("cm_last_used_files", last_n_files);
}

export async function report_increase_tab_stats(
    feed: ApiFields,
    extension: string,
    gitExtension: any,
) {
    // Project name: ignore for now. Maybe it makes sense to send it in plain text to docker backend (because it's private anyway)
    // function get_project_name() {
    //     let projectName = '';
    //     if (gitExtension) {
    //         const git = gitExtension.isActive ? gitExtension.exports.getAPI(1) : null;
    //         if (git) {
    //             const repositories = git.repositories;
    //             if (repositories.length > 0) {
    //                 const projectPath = repositories[0].rootUri.path;
    //                 projectName = projectPath.substring(projectPath.lastIndexOf('/') + 1);
    //                 // const authorEmail = repositories[0].state.HEAD?.commit?.author.email;
    //                 // const username = authorEmail ? authorEmail.split('@')[0] : '';
    //             }
    //         }
    //     }
    //     return projectName;
    // }

    let whole_file: string = feed.sources[feed.cursor_file];
    let grey_text: string = feed.grey_text_explicitly;
    let filename: string = feed.cursor_file;

    let global_context: vscode.ExtensionContext|undefined = global.global_context;
    if (!global_context) {
        return;
    }
    let cm_file_states: {[key: string]: Array<{[key: string]: string}>} | undefined = await global_context.globalState.get("cm_file_states");
    let cm_last_used_files: Array<string> | undefined = await global_context.globalState.get("cm_last_used_files");

    if (!cm_file_states) {
        cm_file_states = {};
    }
    if (!cm_last_used_files) {
        cm_last_used_files = [];
    }

    if (!grey_text) {
        return;
    }
    const fs_record = {
        'completion': grey_text,
        'document': whole_file,
        'model_name': feed.de_facto_model
    };

    if (cm_file_states[filename]) {
        cm_file_states[filename].push(fs_record);
    } else {
        cm_file_states[filename] = [fs_record];
    }
    if (cm_last_used_files.includes(filename)) {
        cm_last_used_files.splice(cm_last_used_files.indexOf(filename), 1);
        cm_last_used_files.push(filename);
    } else {
        cm_last_used_files.push(filename);
    }

    if (cm_file_states[filename].length >= 2) {
        let state0 = cm_file_states[filename][0];
        let state1 = cm_file_states[filename][1];

        let tab_metric_score: [number, [number, number]];
        tab_metric_score = completion_metric_pipeline(
            state0['document'],
            state1['document'],
            state0['completion']
        );

        let scores_stats: Array <{[key: string]: any}> | undefined = await global_context.globalState.get("scores_stats");
        if (!scores_stats) {
            scores_stats = [];
        }

        scores_stats.push({
            "project_hash": "project",
            "file_ext": extension,
            "model_name": state0['model_name'],
            "robot_score": tab_metric_score[0],        // model generated characters remaining / completion.length
            "robot_human_chars": tab_metric_score[1],  // list of two elements [model chars, human chars]
        });

        console.log("SCORES_STATS -->", scores_stats.at(-1));

        await global_context.globalState.update("scores_stats", scores_stats);

        cm_file_states[filename] = [state1];

        // For debug: sent stats each 5 tabs
        // if (scores_stats.length >= 5) {
        //     await report_tab_stats();
        // }
    }
    await global_context.globalState.update("cm_file_states", cm_file_states);
    await global_context.globalState.update("cm_last_used_files", cm_last_used_files);
}


async function report_tab_stats() {

    function merge_tab_stats(scores_stats: Array <{[key: string]: any}>): Array <{[key: string]: any}> {

        function get_avg(arr: Array<number>): number {
            const total = arr.reduce((acc, c) => acc + c, 0);
            return total / arr.length;
        }

        let tab_stats_merged = new Map();
        for (const stat of scores_stats) {
            let key = stat['project_hash'] + '/' + stat['file_ext'] + '/' + stat['model_name'];
            if (tab_stats_merged.has(key)) {
                let val = tab_stats_merged.get(key);
                val['robot_score'].push(stat['robot_score']);
                val['robot_human_chars'][0] += stat['robot_human_chars'][0];
                val['robot_human_chars'][1] += stat['robot_human_chars'][1];
                tab_stats_merged.set(key, val);
            } else {
                tab_stats_merged.set(key, {
                    "project_hash": stat['project_hash'],
                    "file_ext": stat['file_ext'],
                    "model_name": stat['model_name'],
                    "robot_score": [stat['robot_score']],
                    "robot_human_chars": stat['robot_human_chars'],
                });
            }
        }
        let tab_stats_final: Array <{[key: string]: any}> = [];
        for (const [_, val] of tab_stats_merged) {
            val['robot_score'] = get_avg(val['robot_score']);
            val['count'] = val['robot_score'].length;
            tab_stats_final.push(val);
        }
        return tab_stats_final;
    }
    let global_context: vscode.ExtensionContext|undefined = global.global_context;
    if (global_context === undefined) {
        return;
    }
    let scores_stats: Array <{[key: string]: any}> | undefined = await global_context.globalState.get("scores_stats");
    if (!scores_stats || scores_stats.length === 0) {
        return;
    }
    scores_stats = merge_tab_stats(scores_stats);

    const apiKey = userLogin.secret_api_key();
    if (!apiKey) {
        return;
    }
    let client_version = vscode.extensions.getExtension("smallcloud.codify")!.packageJSON.version;
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
    };
    let url = "https://www.smallcloud.ai/v1/tab-stats";
    let response = await fetchH2.fetch(url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
            "client_version": `vscode-${client_version}`,
            "usage": JSON.stringify(scores_stats),
        }),
    });

    if (response.status !== 200) {
        console.log([response.status, url]);
        return;
    }

    await global_context.globalState.update("scores_stats", undefined);
    await declutter_cm_file_states();
}


export async function report_usage_stats()
{
    await report_tab_stats();
    let global_context: vscode.ExtensionContext|undefined = global.global_context;
    if (global_context === undefined) {
        return;
    }
    let count_msg: { [key: string]: number } | undefined = await global_context.globalState.get("usage_stats");
    if (count_msg === undefined) {
        return;
    }
    let usage = "";
    for (let key in count_msg) {
        usage += `${key}\t${count_msg[key]}\n`;
    }
    const apiKey = userLogin.secret_api_key();
    if (!apiKey) {
        return;
    }
    let client_version = vscode.extensions.getExtension("smallcloud.codify")!.packageJSON.version;
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
    };
    let url = "https://www.smallcloud.ai/v1/usage-stats";
    let response = await fetchH2.fetch(url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
            "client_version": `vscode-${client_version}`,
            "usage": usage,
        }),
    });
    if (response.status !== 200) {
        console.log([response.status, url]);
        return;
    }
    await global_context.globalState.update("usage_stats", {});

    let usage_counters: { [key: string]: any } | undefined = await global_context.globalState.get("usage_counters");
    let usage_counters_size = usage_counters ? Object.keys(usage_counters).length : 0;
    if (usage_counters && usage_counters_size > 0) {
        url = "https://www.smallcloud.ai/v1/accept-reject-stats";
        usage_counters["ide_version"] = vscode.version;
        usage_counters["plugin_version"] = `vscode-${client_version}`;
        let usage_counters_str = JSON.stringify(usage_counters);
        response = await fetchH2.fetch(url, {
            method: "POST",
            headers: headers,
            body: JSON.stringify({
                "client_version": `vscode-${client_version}`,
                "usage": usage_counters_str,
            }),
        });
        if (response.status !== 200) {
            console.log([response.status, url]);
            return;
        }
        await global_context.globalState.update("usage_counters", undefined);
    }
}
