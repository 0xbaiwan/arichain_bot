import Mailjs from '@cemalgnlts/mailjs';
import FormData from 'form-data';
import axios from 'axios';
import log from './utils/logger.js'
import beddus from './utils/banner.js'
import {
    delay,
    saveToFile,
    newAgent,
    readFile
} from './utils/helper.js';
import readline from 'readline';

// 获取邀请码
// 邀请码用于注册流程，每个新用户需要提供有效的邀请码才能完成注册
function getInviteCode() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        rl.question('请输入邀请码: ', (code) => {
            rl.close();
            resolve(code);
        });
    });
}

const mailjs = new Mailjs();

// 发送OTP验证码
async function sendOtp(email, proxy) {
    const agent = newAgent(proxy);
    const form = new FormData();
    form.append('email', email);
    form.append('ci_csrf_token', '');

    const headers = {
        ...form.getHeaders(),
    };

    try {
        const response = await axios.post('https://arichain.io/api/Email/send_valid_email', form, {
            headers: headers,
            httpsAgent: agent,
        });
        log.info('发送OTP结果:', response.data);
        return response.data;
    } catch (error) {
        log.error('发送OTP时出错，错误代码:', error.status);
        return null;
    }
}

// 验证OTP验证码
async function checkCode(email, code, proxy) {
    const agent = newAgent(proxy);
    const form = new FormData();
    form.append('email', email);
    form.append('code', code);
    form.append('ci_csrf_token', '');

    const headers = {
        ...form.getHeaders(),
    };

    try {
        const response = await axios.post('https://arichain.io/api/Email/check_valid_code', form, {
            headers: headers,
            httpsAgent: agent,
        });
        log.info('验证验证码结果:', response.data);
        return code;
    } catch (error) {
        log.error('验证验证码时出错，错误代码:', error.status);
        return code;
    }
}

// 注册账号
async function register(email, pw, pw_re, valid_code, invite_code, proxy) {
    const agent = newAgent(proxy);
    const form = new FormData();
    form.append('email', email);
    form.append('pw', pw);
    form.append('pw_re', pw_re);
    form.append('valid_code', valid_code);
    form.append('invite_code', invite_code);
    form.append('ci_csrf_token', '');

    const headers = {
        ...form.getHeaders(),
    };

    try {
        const response = await axios.post('https://arichain.io/api/Account/signup', form, {
            headers: headers,
            httpsAgent: agent,
        });
        log.info('注册结果:', response.data);
        return response.data;
    } catch (error) {
        log.error(`注册${email}时出错，错误代码:`, error.status);
        return null;
    }
}

// 等待邮件到达
async function waitForEmail(mailjs, retries = 10, delay = 5000) {
    for (let i = 0; i < retries; i++) {
        const messages = await mailjs.getMessages();
        if (messages.data.length > 0) {
            const message = messages.data[0];
            const fullMessage = await mailjs.getMessage(message.id);

            const match = fullMessage.data.text.match(/Please complete the email address verification with this code.\s+Thank you.\s+(\d{6})/);
            if (match) return match[1];
        }
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw new Error('未收到验证邮件');
}

async function main() {
    log.info(beddus)
    await delay(3)

    const proxies = await readFile("proxy.txt")
    if (proxies.length === 0) {
        log.warn(`未使用代理运行...`);
    }

    let proxyIndex = 0
    // 获取用户输入的邀请码
    const invite_code = await getInviteCode() // 示例邀请码：`678b90d462361`
    log.warn(`程序开始运行 [ CTRL + C ] 退出...`)

    while (true) {
        try {
            const proxy = proxies[proxyIndex] || null;
            proxyIndex = (proxyIndex + 1) % proxies.length
            let account = await mailjs.createOneAccount();
            while (!account?.data?.username) {
                log.warn('生成新邮箱失败，重试中...');
                await delay(3)
                account = await mailjs.createOneAccount();
            }

            const email = account.data.username;
            const pass = account.data.password;
            const password = `${pass}Ari321#`

            log.info('尝试注册邮箱:', `${email} 使用邀请码: ${invite_code}`);
            log.info('注册使用的代理:', proxy || "未使用代理");
            let sendingOtp = await sendOtp(email, proxy);
            while (!sendingOtp) {
                log.warn('发送OTP失败，重试中...');
                await delay(3)
                sendingOtp = await sendOtp(email, proxy);
            }

            await mailjs.login(email, password);
            const otp = await waitForEmail(mailjs)
            log.info(`邮箱 ${email} 收到OTP:`, otp);
            const valid_code = await checkCode(email, otp, proxy);

            if (valid_code) {
                let response = await register(
                    email,
                    password,
                    password,
                    valid_code,
                    invite_code,
                    proxy
                );
                while (!response) {
                    log.warn(`注册${email}失败，重试中...`)
                    await delay(1)
                    response = await register(
                        email,
                        password,
                        password,
                        valid_code,
                        invite_code,
                        proxy
                    );
                }
                await saveToFile('accounts.txt', `${email}|${password}`)
            }

        } catch (error) {
            log.error(`注册${email}时出错:`, error.message);
        }
        await delay(3)
    }
}

main()
