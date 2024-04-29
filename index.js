require('dotenv').config();
const express = require('express');
const _ = require('lodash')
const bodyParser = require('body-parser');
const axios = require('axios');
const authenticate = require('./src/authenticate');

const app = express();
const port = process.env.PORT || 8080;
const env = process.env.APP_ENV || "PROD";

app.use(bodyParser.json());

async function getAccessToken() {
    console.log("Getting access token")
    const tokenUrl = process.env.CORE_API_OAUTH_TOKEN_URL;
    const clientId = process.env.CORE_API_OAUTH_CLIENT_ID;
    const clientSecret = process.env.CORE_API_OAUTH_CLIENT_SECRET;

    try {
        const accessToken = await authenticate(tokenUrl, clientId, clientSecret);
        return accessToken;
    } catch (error) {
        console.error('Error obtaining access token:', error);
        throw error; // Rethrow the error to handle it in the calling context
    }
}

app.get('/currency-converter', async (req, res) => {
    try {
        const currencyCode = req.query.currencyCode;
        const numberOfDays = req.query.numberOfDays;
        const type = req.query.type;
        const bankCode = req.query.bankCode;
        console.log(`Request received - currencyCode[${currencyCode}] numberOfDays[${numberOfDays}] type[${type}] bankCode[${bankCode}]`);
        if (!currencyCode) {
            return res.status(400).send('currencyCode query parameter is required');
        }
        if (!numberOfDays) {
            return res.status(400).send('numberOfDays query parameter is required');
        }
        if (!bankCode) {
            return res.status(400).send('bankCode query parameter is required');
        }
        if (!type) {
            return res.status(400).send('type query parameter is required');
        }

        const accessToken = env == "DEV" ? "" : await getAccessToken();

        const coreApiServiceUrl = process.env.CORE_API_SERVICE_URL;
        console.log(`Getting bank details - [${coreApiServiceUrl}]`)
        const banksResponse = await axios.get(`${coreApiServiceUrl}/internal/banks`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
        });
        console.log(`Getting exchange rates - [${coreApiServiceUrl}]`)
        const ratesResponse = await axios.get(`${coreApiServiceUrl}/internal/exchange-rates/${type.toLowerCase()}?currencyCode=${currencyCode}&lastNumberOfDays=${numberOfDays}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
        });
        const ratesResponseData = ratesResponse.data;
        const banksResponseData = banksResponse.data;
        
        const bankDetailsMap = getBankDetailsMapByBankCode(banksResponseData);
        const ratesMap = getRatesMapByDate(ratesResponseData);

        const latestDateAvailable = getLatestNthDateAvailable(ratesMap, 1);
        const secondLatestDateAvailable = getLatestNthDateAvailable(ratesMap, 2);
        const latestRateForBank = getLatestRateForBankCode(ratesMap[latestDateAvailable], bankCode);

        const ratesSummary = getRatesSummaryByBank(ratesMap, latestDateAvailable, secondLatestDateAvailable);
        const allBanksSummary = getAllBanksSummary(ratesSummary);

        const response = {
            latestRateForBank,
            ratesSummary,
            ratesMap,
            bankDetailsMap,
            allBanksSummary
        }
        res.status(ratesResponse.status).send(response);
    } catch (error) {
        console.error('Error fetching exchange rates data:', error);
        res.status(error.response ? error.response.status : 500).send(error.message);
    }
});

const getLatestRateForBankCode = (ratesList, bankCode) => {
    return _.filter(ratesList, (entry) => entry.bankCode == bankCode)[0]
}

const getLatestNthDateAvailable = (ratesMap, index = 1) => {
    const dates = _.keys(ratesMap);
    return dates[dates.length - index];
}

const getAllBanksSummary = (ratesSummary) => {
    const averageChange = ratesSummary.map(entry => Number(entry.change)).reduce((a, b) => a + b) / ratesSummary.length;
    return {
        averageRate: ratesSummary.map(entry => Number(entry.rate)).reduce((a, b) => a + b) / ratesSummary.length,
        averagechange: averageChange,
        isPositive: averageChange >= 0
    }
}

const getBankDetailsMapByBankCode = (bankResponse) => {
    return _.keyBy(bankResponse, 'bankCode');
}

const getRatesMapByDate = (ratesResponse) => {
    const flattenRatesList = _.flatMap(_.values(ratesResponse));
    return _.groupBy(flattenRatesList, ({date}) => date);
}

const getRatesSummaryByBank = (ratesMap, latestDateAvailable, secondLatestDateAvailable) => {
    const dates = _.keys(ratesMap);
    console.log(`Considered dates for the requests - ${JSON.stringify(dates)}`)
    const latestRates = ratesMap[latestDateAvailable];
    const secondLatestRatesMap = _.groupBy(ratesMap[secondLatestDateAvailable], 'bankCode');
    return latestRates.map(entry => {
        const { bankCode, rate, lastUpdated } = entry;
        const ratesDataForPreviousDay = secondLatestRatesMap[bankCode][0];
        const diffData = {};
        if (ratesDataForPreviousDay) {
            diffData.change = rate - ratesDataForPreviousDay.rate;
            diffData.isPositive = rate >= ratesDataForPreviousDay.rate;
        }
        return {
            bankCode,
            rate,
            lastUpdated,
            ...diffData
        }
    })
}

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});