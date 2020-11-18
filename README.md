# Jema (Xema Js Agent Library)

[![npm version](https://badge.fury.io/js/jema.svg)](https://badge.fury.io/js/jema)
[![](https://data.jsdelivr.com/v1/package/npm/jema/badge)](https://www.jsdelivr.com/package/npm/jema)

Jema is an addon to the Xema Platform. The goal of this project is to speed up your CRM integration with Xema Platform.

## Installing

Using jsDelivr CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/jema/dist/jema.min.js"></script>
```

Using npm:

```bash
$ npm install jema
```

## Note

On most API calls, the library returns an Observable. This allows the client to receive continous messages from the Xema Platform about Incoming Calls, Messages etc.

## Usage

### HTML / Javascript

```html
<script>

    var url = 'http://192.168.29.60';
    const tester = new Jema.NetworkTester();
    tester.ping(url).subscribe(
        (resp) => {
            console.log(resp.response); // Pong
        },
        (err) => {
            console.log(err);
        }
    );

</script>
```


### Typescript

```js

import { NetworkTester } from 'jema';

const url = 'http://192.168.29.60';
const tester = new NetworkTester();
tester.ping(url).subscribe(
    (resp) => {
        console.log(resp.response); // Pong
    },
    (err) => {
        console.log(err);
    }
);


```
