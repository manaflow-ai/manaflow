# freestyle_client.ObservabilityApi

All URIs are relative to *https://api.freestyle.sh*

Method | HTTP request | Description
------------- | ------------- | -------------
[**handle_get_logs**](ObservabilityApi.md#handle_get_logs) | **GET** /observability/v1/logs | Deployment Logs


# **handle_get_logs**
> FreestyleGetLogsResponse handle_get_logs(deployment_id=deployment_id, domain=domain)

Deployment Logs

Get the logs for a deployment

### Example


```python
import freestyle_client
from freestyle_client.models.freestyle_get_logs_response import FreestyleGetLogsResponse
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
    api_instance = freestyle_client.ObservabilityApi(api_client)
    deployment_id = 'deployment_id_example' # str |  (optional)
    domain = 'domain_example' # str |  (optional)

    try:
        # Deployment Logs
        api_response = api_instance.handle_get_logs(deployment_id=deployment_id, domain=domain)
        print("The response of ObservabilityApi->handle_get_logs:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ObservabilityApi->handle_get_logs: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **deployment_id** | **str**|  | [optional] 
 **domain** | **str**|  | [optional] 

### Return type

[**FreestyleGetLogsResponse**](FreestyleGetLogsResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

