import React, { Component } from 'react';
import Form from 'react-jsonschema-form';
import schema from '../../res/netgen-conf-schema';
import NetGen from '../netgen';
import Beautify from 'json-beautify';
import {UnControlled as CodeMirror} from 'react-codemirror2';
import Debounce from 'debounce';

import 'bootstrap/dist/css/bootstrap.css';
import 'codemirror/lib/codemirror.css';


require('codemirror/mode/javascript/javascript');


class App extends Component {
    constructor(props) {
        super(props);
        this.state = {
            data: {},
            errors: 'No problems has been detected so far.',
        };
        this.buffer = '{}';
        this.checker = Debounce(() => {
            try {
                var rslt = NetGen.check(JSON.parse(JSON.stringify(this.state.data)));
                if (rslt.ok) this.setState({errors: 'No problems has been detected so far.'});
                else {
                    this.setState({errors: rslt.errors.join('\n')});
                }
            } catch (e) {
                this.state.errors = e;
            }
        }, 200);
    }

    render() {
        return (
            <div className="row">
                <div className="col-md-8 col-sm-12 editor">
                    <Form 
                        schema={schema} 
                        onChange={data => {
                            this.setState({data: data.formData});
                        }}
                        formData={this.state.data} 
                    />
                </div>
                <div className="col-md-4 col-sm-12 right-panel">
                    <legend>JSON source</legend>
                    <CodeMirror
                        className="code"
                        value={Beautify(this.state.data, null, 4, 80)}
                        options={{mode: 'javascript', theme: 'default', lineNumbers: true}} 
                        onBlur={() => {
                            this.checker();
                        }}
                        onChange={(editor, data, value) => {
                            this.buffer = value;
                            this.checker();
                        }}
                    />
                    <legend>controls</legend>
                    <button 
                        type="button" 
                        className="ctrl_but"
                        onClick={() => {
                            try {
                                var import_data = JSON.parse(this.buffer);
                                this.setState({data: import_data});
                                this.setState({errors: 'No problems has been detected so far.'});
                            } catch (e) {
                                this.setState({errors: e.toString()});
                            }
                        }}
                    >Load JSON to editor</button>
                    <button 
                        type="button" 
                        className="ctrl_but"
                        onClick={() => {
                            try {
                                var obj = JSON.parse(this.buffer);
                                var rslt = NetGen.generate(obj);
                                if (rslt.ok) {
                                    this.setState({errors: 'No problems has been detected so far.'});
                                    var blob = new Blob([rslt.code], {type: 'text/plain'});
                                    var anchor = document.createElement('a');
                                    anchor.download = 'script.cc';
                                    anchor.href = (window.webkitURL || window.URL).createObjectURL(blob);
                                    anchor.dataset.downloadurl = ['text/plain', anchor.download, anchor.href].join(':');
                                    anchor.click();
                                    anchor.remove();
                                } else this.setState({errors: rslt.errors.join('\n')});
                            } catch (e) {
                                this.setState({errors: e.toString()});
                            }
                            
                        }}
                    >Download Script</button>
                    <button 
                        type="button" 
                        className="ctrl_but"
                        onClick={() => {
                            var json = JSON.stringify(this.state.data);    
                            var blob = new Blob([json], {type: 'text/plain'});
                            var anchor = document.createElement('a');
                            anchor.download = 'configuration.json';
                            anchor.href = (window.webkitURL || window.URL).createObjectURL(blob);
                            anchor.dataset.downloadurl = ['text/plain', anchor.download, anchor.href].join(':');
                            anchor.click();
                            anchor.remove();
                        }}
                    >Download JSON source</button>
                    <legend>console</legend>
                    <pre>{this.state.errors}</pre>
                </div>
            </div>
        );
    }
}

export default App;