import React from 'react';
import { render } from 'react-dom';
import App from './components/app';
import '../style/style.css';

const root = document.getElementById('app');

render(<App />, root);

if (module.hot) module.hot.accept();
