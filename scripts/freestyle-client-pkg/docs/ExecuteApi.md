# freestyle_client.ExecuteApi

All URIs are relative to *https://api.freestyle.sh*

Method | HTTP request | Description
------------- | ------------- | -------------
[**handle_execute_script**](ExecuteApi.md#handle_execute_script) | **POST** /execute/v1/script | Execute Code
[**handle_get_execute_run**](ExecuteApi.md#handle_get_execute_run) | **GET** /execute/v1/deployments/{deployment} | Get information on execute run
[**handle_list_execute_runs**](ExecuteApi.md#handle_list_execute_runs) | **GET** /execute/v1/deployments | List execute runs


# **handle_execute_script**
> HandleExecuteScript200Response handle_execute_script(freestyle_execute_script_params)

Execute Code

Send a TypeScript or JavaScript module, get the result

### Example


```python
import freestyle_client
from freestyle_client.models.freestyle_execute_script_params import FreestyleExecuteScriptParams
from freestyle_client.models.handle_execute_script200_response import HandleExecuteScript200Response
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.ExecuteApi(api_client)
    freestyle_execute_script_params = freestyle_client.FreestyleExecuteScriptParams() # FreestyleExecuteScriptParams | 

    try:
        # Execute Code
        api_response = api_instance.handle_execute_script(freestyle_execute_script_params)
        print("The response of ExecuteApi->handle_execute_script:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ExecuteApi->handle_execute_script: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **freestyle_execute_script_params** | [**FreestyleExecuteScriptParams**](FreestyleExecuteScriptParams.md)|  | 

### Return type

[**HandleExecuteScript200Response**](HandleExecuteScript200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**400** | Error |  -  |
**500** | Internal server error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_get_execute_run**
> HandleGetExecuteRun200Response handle_get_execute_run(deployment)

Get information on execute run

Get information on execute run

### Example


```python
import freestyle_client
from freestyle_client.models.handle_get_execute_run200_response import HandleGetExecuteRun200Response
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.ExecuteApi(api_client)
    deployment = 'deployment_example' # str | 

    try:
        # Get information on execute run
        api_response = api_instance.handle_get_execute_run(deployment)
        print("The response of ExecuteApi->handle_get_execute_run:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ExecuteApi->handle_get_execute_run: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **deployment** | **str**|  | 

### Return type

[**HandleGetExecuteRun200Response**](HandleGetExecuteRun200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | Unauthorized access |  -  |
**404** | Not found |  -  |
**500** | Internal server error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_list_execute_runs**
> HandleListExecuteRuns200Response handle_list_execute_runs(limit=limit, offset=offset)

List execute runs

List execute runs.

### Example


```python
import freestyle_client
from freestyle_client.models.handle_list_execute_runs200_response import HandleListExecuteRuns200Response
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.ExecuteApi(api_client)
    limit = 56 # int |  (optional)
    offset = 56 # int |  (optional)

    try:
        # List execute runs
        api_response = api_instance.handle_list_execute_runs(limit=limit, offset=offset)
        print("The response of ExecuteApi->handle_list_execute_runs:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ExecuteApi->handle_list_execute_runs: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **limit** | **int**|  | [optional] 
 **offset** | **int**|  | [optional] 

### Return type

[**HandleListExecuteRuns200Response**](HandleListExecuteRuns200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**500** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

