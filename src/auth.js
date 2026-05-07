import axios from 'axios';

const FIREBASE_API_KEY = 'AIzaSyB3JWgf04VaRXmweI8f1JlNQ-yZLBwnxTg';
const IDENTITY_BASE = 'https://www.googleapis.com/identitytoolkit/v3/relyingparty';
const SECURETOKEN_BASE = 'https://securetoken.googleapis.com/v1';

export class FirebaseAuth {
    constructor({ apiKey = FIREBASE_API_KEY } = {}) {
        this.apiKey = apiKey;
    }

    async getRecaptchaParam() {
        const { data } = await axios.get(`${IDENTITY_BASE}/getRecaptchaParam`, { params: { key: this.apiKey } });
        return data;
    }

    async sendVerificationCode({ phoneNumber, playIntegrityToken, appSignatureHash = 'n1dJu658sfb' }) {
        const body = {
            phoneNumber,
            autoRetrievalInfo: { appSignatureHash },
            playIntegrityToken,
            clientType: 'CLIENT_TYPE_ANDROID'
        };
        const { data } = await axios.post(`${IDENTITY_BASE}/sendVerificationCode`, body, { params: { key: this.apiKey } });
        return data; // { sessionInfo }
    }

    async verifyPhoneNumber({ sessionInfo, code }) {
        const body = { sessionInfo, code };
        const { data } = await axios.post(`${IDENTITY_BASE}/verifyPhoneNumber`, body, { params: { key: this.apiKey } });
        return data; // { idToken, refreshToken, expiresIn, localId, isNewUser, phoneNumber }
    }

    async getAccountInfo({ idToken }) {
        const { data } = await axios.post(`${IDENTITY_BASE}/getAccountInfo`, { idToken }, { params: { key: this.apiKey } });
        return data;
    }

    async refreshIdToken({ refreshToken }) {
        const params = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
        const { data } = await axios.post(`${SECURETOKEN_BASE}/token`, params.toString(), {
            params: { key: this.apiKey },
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        // returns snake_case from securetoken: id_token, refresh_token, expires_in, user_id, project_id
        return {
            idToken: data.id_token,
            refreshToken: data.refresh_token,
            expiresIn: parseInt(data.expires_in, 10),
            userId: data.user_id
        };
    }
}
